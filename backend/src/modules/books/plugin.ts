import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env, isbndbConfigured } from "../../config/env.js";
import { timeStep, timeSync, timedMethods } from "../../stallLog.js";
import { createObjectStore } from "../../storage/createObjectStore.js";
import { createCompositeCatalog } from "./adapters/catalog/compositeCatalog.js";
import { createThrottle, fetchBytes } from "./adapters/http/http.js";
import { createIsbndbCatalog } from "./adapters/isbndb/isbndbCatalog.js";
import { capDailyCalls } from "./adapters/isbndb/isbndbDailyCap.js";
import { createIsbndbGate } from "./adapters/isbndb/isbndbGate.js";
import { createOpenLibraryCatalog } from "./adapters/openlibrary/openLibraryCatalog.js";
import { createAppleSource } from "./adapters/sources/apple.js";
import { createIsbndbSource } from "./adapters/sources/isbndb.js";
import { createOpenLibraryCoverSource } from "./adapters/sources/openLibrary.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { DETAILS_BATCH_SIZE, startBackfill, startDetailsBackfill, startWorksBackfill } from "./backfill.js";
import { createBooksService, MAX_UPLOAD_BYTES, type BooksService } from "./booksService.js";
import type { FetchCoverImage } from "./coverResolver.js";
import { encodeCover } from "./domain/images.js";
import type { BookLookup } from "./domain/normalize.js";
import { coverUrlFor } from "./publicCoverLookup.js";
import { buildAdminRoutes, buildCatalogRoutes, buildCoverFileRoutes, buildResolveRoutes } from "./routes.js";
import { createCoverWorker } from "./worker.js";

const ISBNDB_GAP_MS = 1100;
const APPLE_GAP_MS = 3200;
const OPEN_LIBRARY_GAP_MS = 1000;
const OPEN_LIBRARY_COVER_GAP_MS = 3100;
const BACKGROUND_ISBNDB_DAILY_CAP = 500;

let activeService: BooksService | null = null;

export function enqueueBookCovers(lookups: BookLookup[]) {
  if (!activeService) throw new Error("Books module is not registered.");
  activeService.enqueueCovers(lookups);
}

export interface BooksPluginOptions {
  alert?: (subject: string, text: string) => Promise<void>;
}

export async function booksPlugin(app: FastifyInstance, options: BooksPluginOptions = {}) {
  const isbndbGate = createIsbndbGate({
    onPause: ({ reason, until }) => {
      app.log.warn({ reason, until }, "ISBNdb paused");
      if (reason !== "key") return;
      options.alert?.("ISBNdb rejected the API key", `ISBNdb answered 401/403, so lookups are paused until ${new Date(until).toISOString()}. Check ISBNDB_API_KEY and the plan.`)
        .catch((error: unknown) => app.log.error({ err: error }, "ISBNdb key alert failed"));
    }
  });
  const repo = timedMethods(createSqliteBooksRepository(timeStep(app.log, "startup:books-open", openBooksDb)), app.log, "books");
  const isbndbThrottle = createThrottle(ISBNDB_GAP_MS);
  const openLibraryThrottle = createThrottle(OPEN_LIBRARY_GAP_MS);
  const openLibraryCoverThrottle = createThrottle(OPEN_LIBRARY_COVER_GAP_MS);
  const fetchImage: FetchCoverImage = async (candidate) => {
    const bytes = candidate.source === "openlibrary"
      ? await openLibraryCoverThrottle(() => fetchBytes(candidate.source, candidate.url))
      : await fetchBytes(candidate.source, candidate.url);
    return bytes ? encodeCover(bytes) : null;
  };
  const backgroundOpenLibrary = createOpenLibraryCatalog(openLibraryThrottle, false);
  const service = createBooksService({
    repo,
    blobs: { save: (id, extension, bytes) => createObjectStore().put(`covers/${id}.${extension}`, bytes, "image/webp") },
    sources: {
      isbndb: isbndbConfigured ? createIsbndbSource(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate) : null,
      apple: createAppleSource(createThrottle(APPLE_GAP_MS)),
      openlibrary: createOpenLibraryCoverSource(openLibraryThrottle)
    },
    catalog: createCompositeCatalog(
      createOpenLibraryCatalog(openLibraryThrottle),
      isbndbConfigured ? createIsbndbCatalog(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate) : null
    ),
    backgroundCatalog: createCompositeCatalog(
      backgroundOpenLibrary,
      isbndbConfigured ? capDailyCalls(createIsbndbCatalog(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate, false), BACKGROUND_ISBNDB_DAILY_CAP) : null,
      true
    ),
    editionRecords: backgroundOpenLibrary,
    fetchImage,
    enqueue: (bookId, priority) => worker.enqueue(bookId, priority),
    publicUrlFor: coverUrlFor,
    adminUserId: env.ADMIN_USER_ID,
    warn: (details, message) => app.log.warn(details, message)
  });
  const worker = createCoverWorker(
    (bookId, lane) => service.processBook(bookId, lane),
    (error, bookId) => app.log.error({ err: error, bookId }, "cover lookup failed")
  );
  timeStep(app.log, "startup:cover-enqueue", () => service.enqueueUnchecked());
  const stopBackfill = startBackfill(() => timeSync(app.log, "cover-enqueue", () => service.enqueueUnchecked()));
  const stopDetailsBackfill = startDetailsBackfill(
    (signal) => service.backfillDetails(DETAILS_BATCH_SIZE, signal),
    (error) => app.log.error({ err: error }, "details backfill failed")
  );
  const stopWorksBackfill = startWorksBackfill(repo, app.log);
  const stopWorkKeyBackfill = startDetailsBackfill(
    (signal) => service.backfillWorkKeys(DETAILS_BATCH_SIZE, signal),
    (error) => app.log.error({ err: error }, "work key backfill failed")
  );
  activeService = service;
  app.addHook("onClose", async () => {
    activeService = null;
    stopBackfill();
    stopDetailsBackfill();
    stopWorksBackfill();
    stopWorkKeyBackfill();
    worker.stop();
  });

  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 1200, timeWindow: "1 minute" });
    await scoped.register(buildResolveRoutes(service));
  });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 300, timeWindow: "1 minute" });
    await scoped.register(buildCatalogRoutes(service));
  });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    await scoped.register(buildAdminRoutes(service));
  });
  await app.register(buildCoverFileRoutes(coverUrlFor));
}
