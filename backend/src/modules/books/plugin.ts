import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env, isbndbConfigured } from "../../config/env.js";
import { timeStep, timeSync, timedMethods } from "../../stallLog.js";
import { createObjectStore } from "../../storage/createObjectStore.js";
import { createCompositeCatalog } from "./adapters/catalog/compositeCatalog.js";
import { onlyMatchingLanguage } from "./adapters/catalog/languageFilter.js";
import { createThrottle, fetchBytes } from "./adapters/http/http.js";
import { createIsbndbBudget, ISBNDB_DAILY_QUOTA, ISBNDB_SEARCH_RESERVE } from "./adapters/isbndb/isbndbBudget.js";
import { createIsbndbCatalog } from "./adapters/isbndb/isbndbCatalog.js";
import { capDailyCalls } from "./adapters/isbndb/isbndbDailyCap.js";
import { createIsbndbGate } from "./adapters/isbndb/isbndbGate.js";
import { createOpenLibraryCatalog } from "./adapters/openlibrary/openLibraryCatalog.js";
import { createAppleSource } from "./adapters/sources/apple.js";
import { createIsbndbSource } from "./adapters/sources/isbndb.js";
import { createOpenLibraryCoverSource } from "./adapters/sources/openLibrary.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { startGenreJobsIfConfigured } from "./genreJudgments.js";
import { genreReviewWith, reviewGenreWith } from "./genreReview.js";
import { startSynopsisJobsIfConfigured } from "./synopsisJudgments.js";
import { reviewSynopsisWith, synopsisReviewWith } from "./synopsisReview.js";
import { arenaCheck, startTranslationJobsIfConfigured } from "./translationJudgments.js";
import { reviewTranslationWith, translationReviewWith } from "./translationReview.js";
import { isPortuguese } from "./domain/translation.js";
import type { HeldWork } from "./genrePass.js";
import { DETAILS_BATCH_SIZE, startBackfill, startCoverColorBackfill, startDetailsBackfill, startWorksBackfill, startWorksGrouping } from "./backfill.js";
import { createBooksService, MAX_UPLOAD_BYTES, type BooksService } from "./booksService.js";
import type { FetchCoverImage } from "./coverResolver.js";
import { encodeCover } from "./domain/images.js";
import type { BookLookup } from "./domain/normalize.js";
import { coverUrlFor, useBooksRepository } from "./publicCoverLookup.js";
import { buildAdminRoutes, buildCatalogRoutes, buildCoverFileRoutes, buildGenreReviewRoutes, buildResolveRoutes, buildSynopsisReviewRoutes, buildTranslationReviewRoutes } from "./routes.js";
import { RETITLE_BATCH_SIZE, retitleWanted } from "./retitleJob.js";
import { applyMojibakeRepairs } from "./seed/mojibakeRepair.js";
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
  heldWorks?: () => HeldWork[];
  worksShareAnArena?: (aIds: string[], bIds: string[]) => boolean;
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
  const booksDb = timeStep(app.log, "startup:books-open", openBooksDb);
  const repo = timedMethods(createSqliteBooksRepository(booksDb), app.log, "books");
  useBooksRepository(repo);
  const isbndbSpend = createIsbndbBudget(repo, ISBNDB_DAILY_QUOTA - ISBNDB_SEARCH_RESERVE, (message) => app.log.warn(message));
  const heldWorks = options.heldWorks;
  const alertTypesafe = (subject: string, text: string) => {
    app.log.warn({ subject }, text);
    options.alert?.(subject, text).catch((error: unknown) => app.log.error({ err: error }, "TypeSafe key alert failed"));
  };
  const genreJobs = heldWorks
    ? startGenreJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: alertTypesafe,
        onError: (error, workId) => app.log.error({ err: error, workId }, "genre judgment failed"),
        info: (details, message) => app.log.info(details, message)
      })
    : null;
  const synopsisJobs = heldWorks
    ? startSynopsisJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: alertTypesafe,
        info: (details, message) => app.log.info(details, message),
        onError: (error, workId) => app.log.error({ err: error, workId }, "synopsis judgment failed")
      })
    : null;
  const sharesArena = options.worksShareAnArena ? arenaCheck(repo, options.worksShareAnArena) : () => false;
  const translationJobs = heldWorks
    ? startTranslationJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        sharesArena,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: alertTypesafe,
        info: (details, message) => app.log.info(details, message),
        onError: (error, workId) => app.log.error({ err: error, workId }, "translation matching failed")
      })
    : null;
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
    blobs: {
      save: (id, extension, bytes) => createObjectStore().put(`covers/${id}.${extension}`, bytes, "image/webp"),
      read: (id, extension) => createObjectStore().get(`covers/${id}.${extension}`)
    },
    sources: {
      isbndb: isbndbConfigured ? createIsbndbSource(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate, isbndbSpend) : null,
      apple: createAppleSource(createThrottle(APPLE_GAP_MS)),
      openlibrary: createOpenLibraryCoverSource(openLibraryThrottle)
    },
    catalog: createCompositeCatalog(
      onlyMatchingLanguage(createOpenLibraryCatalog(openLibraryThrottle)),
      isbndbConfigured ? onlyMatchingLanguage(createIsbndbCatalog(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate, true, { details: isbndbSpend })) : null
    ),
    backgroundCatalog: createCompositeCatalog(
      onlyMatchingLanguage(backgroundOpenLibrary),
      isbndbConfigured ? onlyMatchingLanguage(capDailyCalls(createIsbndbCatalog(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate, false, { details: isbndbSpend }), BACKGROUND_ISBNDB_DAILY_CAP)) : null,
      true
    ),
    editionRecords: backgroundOpenLibrary,
    fetchImage,
    enqueue: (bookId, priority) => worker.enqueue(bookId, priority),
    publicUrlFor: coverUrlFor,
    adminUserId: env.ADMIN_USER_ID,
    warn: (details, message) => app.log.warn(details, message),
    onDetailsChecked: (book) => {
      if (!book.work_id) return;
      genreJobs?.add(book.work_id);
      synopsisJobs?.add(book.work_id);
      if (isPortuguese(book.language)) translationJobs?.add(book.work_id);
    }
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
  const grouping = startWorksGrouping((limit) => repo.groupKeylessWorks(limit), app.log);
  const stopWorkKeyBackfill = startDetailsBackfill(
    (signal) => service.backfillWorkKeys(DETAILS_BATCH_SIZE, signal),
    (error) => app.log.error({ err: error }, "work key backfill failed")
  );
  const stopColorBackfill = startCoverColorBackfill((limit) => service.fillCoverColors(limit), app.log);
  const retitleIsbndb = isbndbConfigured ? createIsbndbCatalog(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate, false, { details: isbndbSpend, search: isbndbSpend }) : null;
  const stopRetitleJob = retitleIsbndb
    ? startDetailsBackfill(
        (signal) => retitleWanted({
          repo,
          isbndb: retitleIsbndb,
          write: (plan) => applyMojibakeRepairs(booksDb, plan),
          info: (details, message) => app.log.info(details, message),
          warn: (details, message) => app.log.warn(details, message)
        }, RETITLE_BATCH_SIZE, signal),
        (error) => app.log.error({ err: error }, "lossy retitle failed")
      )
    : null;
  activeService = service;
  app.addHook("onClose", async () => {
    activeService = null;
    stopBackfill();
    stopDetailsBackfill();
    stopWorksBackfill();
    grouping.stop();
    stopWorkKeyBackfill();
    stopColorBackfill();
    stopRetitleJob?.();
    genreJobs?.stop();
    synopsisJobs?.stop();
    translationJobs?.stop();
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
    await scoped.register(buildAdminRoutes(service, () => grouping.runNow()));
  });
  if (heldWorks) {
    await app.register(async (scoped) => {
      await scoped.register(fastifyRateLimit, { max: 300, timeWindow: "1 minute" });
      await scoped.register(buildGenreReviewRoutes({
        isAdmin: (userId) => service.isAdmin(userId),
        review: () => genreReviewWith(repo, heldWorks(), (imageId) => coverUrlFor(imageId, "thumb")),
        decide: (workId, action) => reviewGenreWith(repo, workId, action, Date.now, (id) => genreJobs?.add(id))
      }));
      await scoped.register(buildSynopsisReviewRoutes({
        isAdmin: (userId) => service.isAdmin(userId),
        review: () => synopsisReviewWith(repo, heldWorks(), (imageId) => coverUrlFor(imageId, "thumb")),
        decide: (hash, decision) => reviewSynopsisWith(repo, hash, decision, Date.now)
      }));
      await scoped.register(buildTranslationReviewRoutes({
        isAdmin: (userId) => service.isAdmin(userId),
        review: () => translationReviewWith(repo, heldWorks(), (imageId) => coverUrlFor(imageId, "thumb")),
        decide: (workId, action) => reviewTranslationWith({ repo, sharesArena, now: Date.now }, workId, action)
      }));
    });
  }
  await app.register(buildCoverFileRoutes(coverUrlFor));
}
