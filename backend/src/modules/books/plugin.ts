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
import { walkDuplicateWorks } from "./duplicateWorks.js";
import { startOriginalArrivals } from "./originalArrivals.js";
import { arenaCheck, startTranslationJobsIfConfigured } from "./translationJudgments.js";
import { reviewTranslationWith, translationReviewWith } from "./translationReview.js";
import { isPortuguese } from "./domain/translation.js";
import type { HeldWork } from "./genrePass.js";
import { BACKFILL_INTERVAL_MS, createJobs } from "../../jobs.js";
import { DETAILS_BATCH_SIZE, startCoverColorBackfill, startWorksBackfill, startWorksGrouping } from "./backfill.js";
import { createBooksService, MAX_UPLOAD_BYTES, type BooksService } from "./booksService.js";
import type { FetchCoverImage } from "./coverResolver.js";
import { encodeCover } from "./domain/images.js";
import type { BookLookup } from "./domain/normalize.js";
import type { CoverBlobReader, CoverBlobStore } from "./domain/ports.js";
import { coverUrlFor, useBooksRepository } from "./publicCoverLookup.js";
import { buildAdminRoutes, buildCatalogRoutes, buildCoverFileRoutes, buildGenreReviewRoutes, buildResolveRoutes, buildSynopsisReviewRoutes, buildTranslationReviewRoutes } from "./routes.js";
import { RETITLE_BATCH_SIZE, retitleWanted } from "./retitleJob.js";
import { BNP_SYNC_INTERVAL_MS, fetchBnpPage, fetchBnpScan, logBnpSync, lookupBnpIsbn, syncBnp, type BnpHarvestDeps } from "./seed/bnpImport.js";
import { fetchText } from "./seed/siteFetch.js";
import { createCoverWorker } from "./worker.js";

const ISBNDB_GAP_MS = 1100;
const APPLE_GAP_MS = 3200;
const OPEN_LIBRARY_GAP_MS = 1000;
const OPEN_LIBRARY_COVER_GAP_MS = 3100;
const BACKGROUND_ISBNDB_DAILY_CAP = 500;
const BNP_LOOKUP_TIMEOUT_MS = 5_000;
const FIRST_RUN_DELAY_MS = {
  detailsBackfill: 30_000,
  workKeyBackfill: 40_000,
  worksBackfill: 45_000,
  colorBackfill: 50_000,
  retitleJob: 55_000,
  genreSweep: 60_000,
  synopsisSweep: 75_000,
  translationSweep: 90_000,
  worksGrouping: 120_000,
  bnpSync: 150_000
};

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
  const jobs = createJobs(app.log);
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
        info: (details, message) => app.log.info(details, message),
        initialDelayMs: FIRST_RUN_DELAY_MS.genreSweep
      })
    : null;
  const synopsisJobs = heldWorks
    ? startSynopsisJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: alertTypesafe,
        info: (details, message) => app.log.info(details, message),
        onError: (error, workId) => app.log.error({ err: error, workId }, "synopsis judgment failed"),
        initialDelayMs: FIRST_RUN_DELAY_MS.synopsisSweep
      })
    : null;
  const sharesArena = options.worksShareAnArena ? arenaCheck(repo, options.worksShareAnArena) : () => false;
  const stopOriginalArrivals = startOriginalArrivals({
    repo,
    sharesArena,
    now: Date.now,
    info: (details, message) => app.log.info(details, message),
    onError: (error, titleKey) => app.log.error({ err: error, titleKey }, "original arrivals failed")
  });
  const translationJobs = heldWorks
    ? startTranslationJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        sharesArena,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: alertTypesafe,
        info: (details, message) => app.log.info(details, message),
        onError: (error, workId) => app.log.error({ err: error, workId }, "translation matching failed"),
        initialDelayMs: FIRST_RUN_DELAY_MS.translationSweep
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
  const blobs: CoverBlobStore & CoverBlobReader = {
    save: (id, extension, bytes) => createObjectStore().put(`covers/${id}.${extension}`, bytes, "image/webp"),
    read: (id, extension) => createObjectStore().get(`covers/${id}.${extension}`)
  };
  const bnpDeps: BnpHarvestDeps = {
    repo,
    blobs,
    fetchScan: fetchBnpScan,
    fetchText: fetchBnpPage,
    now: () => new Date(),
    log: (line) => app.log.info({ bnp: line }, "bnp sync window")
  };
  const bnpLookupDeps: BnpHarvestDeps = {
    ...bnpDeps,
    fetchText: (url) => fetchText(url, BNP_LOOKUP_TIMEOUT_MS),
    fetchScan: (url) => fetchBnpScan(url, BNP_LOOKUP_TIMEOUT_MS)
  };
  const service = createBooksService({
    repo,
    blobs,
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
    sharesArena,
    warn: (details, message) => app.log.warn(details, message),
    bnpLookup: (isbn) => lookupBnpIsbn(bnpLookupDeps, isbn),
    heldWorkIds: heldWorks ? () => heldWorks().map((work) => work.workId) : undefined,
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
  jobs.every("cover-enqueue", BACKFILL_INTERVAL_MS, () => timeSync(app.log, "cover-enqueue", () => service.enqueueUnchecked()));
  jobs.every("details backfill", BACKFILL_INTERVAL_MS, (signal) => service.backfillDetails(DETAILS_BATCH_SIZE, signal), FIRST_RUN_DELAY_MS.detailsBackfill);
  jobs.own(startWorksBackfill(repo, app.log, undefined, undefined, FIRST_RUN_DELAY_MS.worksBackfill));
  const grouping = startWorksGrouping(
    (signal) => walkDuplicateWorks({ repo, sharesArena, now: Date.now }, { dryRun: false, signal, pageSize: 100, pauseMs: 250 }).then((report) => report.merges.length),
    (limit) => repo.groupKeylessWorks(limit, undefined, sharesArena),
    app.log,
    undefined,
    undefined,
    FIRST_RUN_DELAY_MS.worksGrouping
  );
  jobs.own(grouping.stop);
  jobs.every("work key backfill", BACKFILL_INTERVAL_MS, (signal) => service.backfillWorkKeys(DETAILS_BATCH_SIZE, signal), FIRST_RUN_DELAY_MS.workKeyBackfill);
  jobs.own(startCoverColorBackfill((limit) => service.fillCoverColors(limit), app.log, undefined, undefined, FIRST_RUN_DELAY_MS.colorBackfill));
  if (isbndbConfigured) {
    const retitleIsbndb = createIsbndbCatalog(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate, false, { details: isbndbSpend, search: isbndbSpend });
    jobs.every("lossy retitle", BACKFILL_INTERVAL_MS, (signal) => retitleWanted({
      repo,
      isbndb: retitleIsbndb,
      write: (plan) => repo.applyTitleRepairs(plan),
      info: (details, message) => app.log.info(details, message),
      warn: (details, message) => app.log.warn(details, message)
    }, RETITLE_BATCH_SIZE, signal), FIRST_RUN_DELAY_MS.retitleJob);
  }
  jobs.every("bnp sync", BNP_SYNC_INTERVAL_MS, async () => {
    const report = await syncBnp(bnpDeps);
    if (report) logBnpSync(app.log, report);
  }, FIRST_RUN_DELAY_MS.bnpSync);
  if (genreJobs) jobs.own(genreJobs.stop);
  if (synopsisJobs) jobs.own(synopsisJobs.stop);
  if (translationJobs) jobs.own(translationJobs.stop);
  jobs.own(stopOriginalArrivals);
  jobs.own(worker.stop);
  activeService = service;
  app.addHook("onClose", async () => {
    activeService = null;
    jobs.stopAll();
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
