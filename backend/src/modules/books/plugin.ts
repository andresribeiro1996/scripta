import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env, isbndbConfigured } from "../../config/env.js";
import { createFsCoverBlobStore } from "./adapters/fs/fsCoverBlobStore.js";
import { createThrottle, fetchBytes } from "./adapters/http/http.js";
import { createOpenLibraryCatalog } from "./adapters/openlibrary/openLibraryCatalog.js";
import { createAppleSource } from "./adapters/sources/apple.js";
import { createIsbndbSource } from "./adapters/sources/isbndb.js";
import { createOpenLibraryCoverSource } from "./adapters/sources/openLibrary.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { createBooksService, MAX_UPLOAD_BYTES } from "./booksService.js";
import type { FetchCoverImage } from "./coverResolver.js";
import { encodeCover } from "./domain/images.js";
import { buildAdminRoutes, buildCatalogRoutes, buildCoverFileRoutes, buildResolveRoutes } from "./routes.js";
import { createCoverWorker } from "./worker.js";

const ISBNDB_GAP_MS = 1100;
const APPLE_GAP_MS = 3200;
const OPEN_LIBRARY_GAP_MS = 1000;

export async function booksPlugin(app: FastifyInstance) {
  const repo = createSqliteBooksRepository(openBooksDb());
  const openLibraryThrottle = createThrottle(OPEN_LIBRARY_GAP_MS);
  const fetchImage: FetchCoverImage = async (candidate) => {
    const bytes = await fetchBytes(candidate.source, candidate.url);
    return bytes ? encodeCover(bytes) : null;
  };
  const service = createBooksService({
    repo,
    blobs: createFsCoverBlobStore(env.COVERS_STORAGE_PATH),
    sources: {
      isbndb: isbndbConfigured ? createIsbndbSource(env.ISBNDB_API_KEY, createThrottle(ISBNDB_GAP_MS)) : null,
      apple: createAppleSource(createThrottle(APPLE_GAP_MS)),
      openlibrary: createOpenLibraryCoverSource(openLibraryThrottle)
    },
    catalog: createOpenLibraryCatalog(openLibraryThrottle),
    fetchImage,
    enqueue: (bookId, front) => worker.enqueue(bookId, front),
    publicUrlFor: (id, size) => `${env.PUBLIC_API_URL}/covers/cached/${id}/${size}`,
    adminUserId: env.ADMIN_USER_ID,
    warn: (details, message) => app.log.warn(details, message)
  });
  const worker = createCoverWorker(
    (bookId) => service.processBook(bookId),
    (error, bookId) => app.log.error({ err: error, bookId }, "cover lookup failed")
  );
  app.addHook("onClose", async () => worker.stop());

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
  await app.register(buildCoverFileRoutes(service));
}
