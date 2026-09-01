// Composition root — mirrors modules/gallery/plugin.ts's shape.
//
// Registers UNCONDITIONALLY now, unlike the module's very first version —
// caching Kobo CDN/Open Library/Google Books hits needs no key at all,
// so there's no reason to gate the whole module behind Hardcover being
// configured. Only the Hardcover STEP within the resolution chain is
// conditional (see below) — service.ts's own resolveCover already treats
// a missing hardcoverLookup as "skip that one candidate," the exact same
// "an unavailable source just means try the next thing" contract every
// other candidate already follows.

import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env, hardcoverConfigured, useObjectStorage, usePostgres } from "../../config/env.js";
import { createFsCoverBlobStore } from "./adapters/fs/fsCoverBlobStore.js";
import { createS3CoverBlobStore } from "./adapters/s3/s3CoverBlobStore.js";
import { createHardcoverCoverLookup } from "./adapters/hardcover/hardcoverCoverLookup.js";
import { openCoversDb } from "./adapters/sqlite/connection.js";
import { createPgCoverCacheRepository } from "./adapters/postgres/pgCoverCacheRepository.js";
import { initCoversSchema } from "./adapters/postgres/connection.js";
import { getPool } from "../../shared/postgres/pool.js";
import type { CoverCacheRepository } from "./domain/ports.js";
import { createSqliteCoverCacheRepository } from "./adapters/sqlite/sqliteCoverCacheRepository.js";
import { buildCachedFileRoute, buildResolveRoute } from "./routes.js";
import { createCoversService } from "./service.js";

export async function coversPlugin(app: FastifyInstance) {
  // --- composition: swap any of these to change storage/lookup technology ---
  let cacheRepo: CoverCacheRepository;

  if (usePostgres) {
    app.log.info("[covers] using Postgres (DATABASE_URL is set)");
    const pool = getPool();
    await initCoversSchema(pool);
    cacheRepo = createPgCoverCacheRepository(pool);
  } else {
    const db = openCoversDb();
    cacheRepo = createSqliteCoverCacheRepository(db);
    app.addHook("onClose", async () => {
      db.close();
    });
  }
  // Same one-variable decision as gallery's own blob store.
  const blobStore = useObjectStorage ? createS3CoverBlobStore() : createFsCoverBlobStore(env.COVERS_STORAGE_PATH);
  app.log.info(`[covers] cover blobs: ${useObjectStorage ? `object storage (${env.S3_BUCKET})` : env.COVERS_STORAGE_PATH}`);
  const hardcoverLookup = hardcoverConfigured ? createHardcoverCoverLookup(env.HARDCOVER_API_KEY) : null;
  const publicUrlFor = (id: string) => `${env.PUBLIC_API_URL}/covers/cached/${id}/file`;
  const coversService = createCoversService(cacheRepo, blobStore, hardcoverLookup, publicUrlFor);
  // ---------------------------------------------------------------------------

  // Two SEPARATE registrations, each its own Fastify encapsulation scope
  // (an inline async plugin function, same trick modules/auth/plugin.ts's
  // own rate-limit scoping already uses) — @fastify/rate-limit applies
  // per-scope, so each of these gets its own independent limit rather
  // than sharing one. That split matters here specifically: a resolve on
  // a cache MISS can mean 4-5 sequential external requests plus a sharp
  // re-encode, genuinely worth protecting; a cached-file read is a
  // single local disk read, the same cost profile gallery's own
  // (unlimited) GET /gallery/:id/file already has. A real library's full
  // page load fires roughly one of EACH per book, nearly simultaneously —
  // discovered live, loading a 26-book test library: a single SHARED
  // 60/min limit covering both routes let the file-serving route get
  // starved by the resolve route's own traffic, 429ing plain cached-image
  // requests that had nothing to do with the expensive path at all (and
  // browsers treat a JSON error body served in place of an expected image
  // as a hard failure — ERR_BLOCKED_BY_ORB — not a retryable one).
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 300, timeWindow: "1 minute" });
    await scoped.register(buildResolveRoute(coversService));
  });

  // No rate limit at all — same as gallery's own file-serving route.
  // Nothing here does external network calls or re-encoding; it's a
  // lookup by an unguessable UUID and a local file read, the exact same
  // trust/cost model as a plain static asset.
  await app.register(buildCachedFileRoute(coversService));
}
