// Loads and validates process.env once, at startup. Every other module
// reads config through this typed object — never process.env directly —
// so a missing/malformed var fails loudly at boot instead of silently
// deep inside a request handler.

import "dotenv/config";
import { z } from "zod";

// "15m", "1h", "30d" — a single integer + unit. Kept intentionally
// stricter than jsonwebtoken's own underlying `ms`-style parsing (which
// accepts things like "2 days" or a bare number of seconds) so that a
// value valid here is guaranteed valid everywhere it's used, without each
// call site needing to know which parser it's feeding.
const durationString = z
  .string()
  .regex(/^\d+[smhd]$/, 'must look like "15m", "1h", or "30d" — a number followed by s/m/h/d');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  // Gates anything that must not exist on a public deployment — currently
  // auth's browser test console (see modules/auth/plugin.ts). Defaults to
  // development so a contributor's checkout keeps the dev affordances
  // without configuring anything; a deployment sets this to "production".
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Whether to believe X-Forwarded-For, and how far. Every managed host
  // puts a proxy in front of the app, and without this `request.ip` is the
  // PROXY's address for every request — so all four per-module rate
  // limiters collapse into one shared bucket and the login brute-force
  // protection stops protecting anything.
  //
  // Deliberately NOT hardcoded to true: trusting the header when there is
  // NO proxy in front is the mirror-image bug, letting any client spoof
  // its own IP and skip the rate limiter by setting X-Forwarded-For
  // itself. So this is explicit per deployment. Accepted values:
  //   "false" (default)  — direct exposure, use the socket address
  //   "true"             — behind a trusted proxy that sets the header
  //   "10.0.0.0/8,..."   — comma-separated trusted IPs/CIDRs (strictest)
  //
  // A bare hop COUNT is deliberately not offered: Fastify treats a numeric
  // trustProxy as fail-closed (it cannot validate the immediate peer, so it
  // trusts nothing), which would silently leave a deployment that set
  // TRUST_PROXY=1 with no proxy trust at all — the exact bug this variable
  // exists to prevent, now harder to spot. A digits-only value is rejected
  // at boot rather than quietly misbehaving.
  TRUST_PROXY: z
    .string()
    .default("false")
    .refine(
      (v) => !/^\d+$/.test(v.trim()),
      'a proxy hop count is not supported — use "true", or a comma-separated list of trusted proxy IPs/CIDRs'
    ),

  // The frontend's origin, for CORS — see app.ts. A dev Vite server
  // defaults to 5173; change this once the frontend is actually deployed
  // somewhere else.
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  // --- library storage: Postgres when set, SQLite otherwise -------------
  //
  // The library module picks its adapter on this alone (see
  // modules/library/plugin.ts). Everything else — auth, gallery, covers,
  // socials — is still SQLite-only; library went first because it is the
  // one whose data model made a single machine a hard ceiling. See
  // docs/DEPLOYMENT-PLAN.md phase 3.
  //
  // Migrating an existing SQLite deployment: scripts/sqlite-to-postgres.mjs.
  DATABASE_URL: z.string().optional().default(""),
  // "on" (default, verify the certificate) | "no-verify" (encrypted but
  // unverified — some managed providers present a chain the container has
  // no root for) | "off" (no TLS at all; local development only).
  DATABASE_SSL: z.enum(["on", "no-verify", "off"]).default("on"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  // --- blob storage: object storage when set, local disk otherwise -----
  //
  // Gallery uploads and the resolved-cover cache. Set S3_BUCKET and both
  // move to object storage; leave it blank and nothing changes.
  //
  // This is the OTHER thing pinning the API to one machine — Postgres
  // alone does not free it, because blobs on local disk mean the container
  // can only run in one place. Written against the S3 API, so Cloudflare
  // R2 (recommended: zero egress, and covers are served on every page
  // view), Backblaze B2, MinIO or AWS S3 all work.
  S3_BUCKET: z.string().optional().default(""),
  // R2 and MinIO need an explicit endpoint; real AWS S3 infers one from
  // the region, so leave this blank there.
  S3_ENDPOINT: z.string().optional().default(""),
  // R2 ignores the region but the SDK requires one; "auto" is what
  // Cloudflare's own documentation uses.
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  // Bucket in the path rather than the hostname. Required by R2 and
  // MinIO; harmless on AWS.
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),

  AUTH_DB_PATH: z.string().min(1),
  // Ignored when DATABASE_URL is set. Still required, so that switching
  // to Postgres and back doesn't need config archaeology.
  LIBRARY_DB_PATH: z.string().min(1),
  GALLERY_DB_PATH: z.string().min(1),
  // Where uploaded images are actually stored on disk, one subdirectory
  // per account — see modules/gallery/adapters/fs/fsImageBlobStore.ts.
  GALLERY_STORAGE_PATH: z.string().min(1),

  // The auto-resolved cover cache (modules/covers) — a GLOBAL store, one
  // row per book identifier (isbn/imageId) shared across every account,
  // unlike gallery's own per-account images. Not optional/key-gated the
  // way HARDCOVER_API_KEY is below — this caches Kobo CDN/Open Library
  // hits too, which need no key at all, so it's always on. Defaults
  // provided (same style as the DB/storage paths above) since there's no
  // real reason a deployment would need to opt out of this.
  COVERS_DB_PATH: z.string().min(1).default("./data/covers.sqlite"),
  COVERS_STORAGE_PATH: z.string().min(1).default("./data/covers-files"),
  // modules/socials' own SQLite file — same one-file-per-module isolation
  // as every other module's *_DB_PATH above.
  SOCIALS_DB_PATH: z.string().min(1).default("./data/socials.sqlite"),
  // This API's own externally-reachable base URL — needed to build
  // absolute image URLs (GET /gallery/:id/file) that resolve correctly
  // from the frontend's own origin, which a relative path wouldn't (see
  // modules/gallery/plugin.ts's publicUrlFor). Defaults to the dev
  // backend's own address; set this to the real deployed origin in prod.
  PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET should be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET should be at least 32 chars"),
  ACCESS_TOKEN_TTL: durationString.default("15m"),
  REFRESH_TOKEN_TTL: durationString.default("30d"),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_CALLBACK_URL: z.string().optional().default(""),
  OAUTH_SUCCESS_REDIRECT_URL: z.string().optional().default(""),

  // Optional — from https://hardcover.app account settings. See
  // modules/covers. Left blank, the covers module simply doesn't
  // register its route (same "optional integration, quietly skipped"
  // shape Google OAuth above already uses).
  HARDCOVER_API_KEY: z.string().optional().default(""),

  // modules/socials — one client id/secret/callback triple per platform,
  // same "optional, quietly skipped if blank" shape as Google/Hardcover
  // above. Each platform requires the user to register a real developer
  // app on that platform's own site; see backend/.env.example for links.
  X_CLIENT_ID: z.string().optional().default(""),
  X_CLIENT_SECRET: z.string().optional().default(""),
  X_CALLBACK_URL: z.string().optional().default(""),

  INSTAGRAM_CLIENT_ID: z.string().optional().default(""),
  INSTAGRAM_CLIENT_SECRET: z.string().optional().default(""),
  INSTAGRAM_CALLBACK_URL: z.string().optional().default(""),

  THREADS_CLIENT_ID: z.string().optional().default(""),
  THREADS_CLIENT_SECRET: z.string().optional().default(""),
  THREADS_CALLBACK_URL: z.string().optional().default(""),

  // TikTok's own docs call this "client_key", not "client_id" — kept
  // named that way here so it's obvious which value from their developer
  // portal goes here, even though modules/socials still sends it as
  // whatever OAuth2 param name that provider's config specifies.
  TIKTOK_CLIENT_KEY: z.string().optional().default(""),
  TIKTOK_CLIENT_SECRET: z.string().optional().default(""),
  TIKTOK_CALLBACK_URL: z.string().optional().default(""),

  // Where to send the browser back after a connect/disconnect round trip
  // completes (success or failure) — the settings page, not a dedicated
  // callback route like OAUTH_SUCCESS_REDIRECT_URL, since no tokens ride
  // this redirect (see modules/socials/routes.ts): the backend already
  // stored the connection server-side, so the frontend just needs to
  // land back on Settings and re-fetch the list.
  SOCIALS_SUCCESS_REDIRECT_URL: z.string().optional().default(""),

  // Symmetric key (AES-256-GCM) used to encrypt every social platform's
  // access/refresh token at rest — see modules/socials/crypto.ts. Blank
  // by default like the other optional integrations above, but unlike
  // those, leaving it blank doesn't just skip one provider: it disables
  // ALL of socials' write endpoints (connect/disconnect), Bluesky
  // included, since Bluesky needs nowhere else to prove "configured".
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  SOCIALS_ENCRYPTION_KEY: z
    .string()
    .optional()
    .default("")
    .refine(
      (v) => v === "" || /^[0-9a-f]{64}$/i.test(v),
      "must be blank, or a 64-character hex string (32 bytes) — generate with node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

/** Whether the library module should use Postgres rather than SQLite.
 *  One variable, one decision — see modules/library/plugin.ts. */
export const usePostgresLibrary = env.DATABASE_URL !== "";

/** Whether gallery uploads and the cover cache live in object storage
 *  rather than on local disk. One variable, one decision — see each
 *  module's plugin.ts. Credentials are checked alongside the bucket so a
 *  half-configured deployment fails at boot rather than on the first
 *  upload. */
export const useObjectStorage = env.S3_BUCKET !== "";

if (useObjectStorage && (env.S3_ACCESS_KEY_ID === "" || env.S3_SECRET_ACCESS_KEY === "")) {
  // Deliberately fatal rather than a warning: a bucket configured without
  // credentials would fail on the first upload a real user attempted,
  // which is a far worse place to discover it than boot.
  console.error("S3_BUCKET is set but S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are not — object storage cannot be used without credentials.");
  process.exit(1);
}

/** Parses TRUST_PROXY into the shape Fastify's own `trustProxy` option
 *  expects: a boolean, or a list of trusted IPs/CIDRs. Exported separately
 *  from the resolved value below so it can be tested against real Fastify
 *  behaviour without re-importing this module under a different
 *  environment. See the variable's own comment above. */
export function parseTrustProxy(raw: string): boolean | string[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "false") return false;
  if (trimmed.toLowerCase() === "true") return true;
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export const trustProxy = parseTrustProxy(env.TRUST_PROXY);

// Google OAuth is optional — the module runs fine as email/password-only
// if these are left blank, it just skips registering the Google routes.
export const googleOAuthConfigured =
  env.GOOGLE_CLIENT_ID !== "" && env.GOOGLE_CLIENT_SECRET !== "" && env.GOOGLE_CALLBACK_URL !== "";

// Same idea, one variable instead of three — see modules/covers/plugin.ts.
export const hardcoverConfigured = env.HARDCOVER_API_KEY !== "";

// modules/socials — same "all three or none" shape as googleOAuthConfigured
// above, one per platform. See modules/socials/providerConfig.ts for where
// these actually get used.
export const xOAuthConfigured = env.X_CLIENT_ID !== "" && env.X_CLIENT_SECRET !== "" && env.X_CALLBACK_URL !== "";
export const instagramOAuthConfigured =
  env.INSTAGRAM_CLIENT_ID !== "" && env.INSTAGRAM_CLIENT_SECRET !== "" && env.INSTAGRAM_CALLBACK_URL !== "";
export const threadsOAuthConfigured =
  env.THREADS_CLIENT_ID !== "" && env.THREADS_CLIENT_SECRET !== "" && env.THREADS_CALLBACK_URL !== "";
export const tiktokOAuthConfigured =
  env.TIKTOK_CLIENT_KEY !== "" && env.TIKTOK_CLIENT_SECRET !== "" && env.TIKTOK_CALLBACK_URL !== "";

// Gates every write endpoint in modules/socials, Bluesky included — see
// SOCIALS_ENCRYPTION_KEY's own comment above for why.
export const socialsEncryptionConfigured = env.SOCIALS_ENCRYPTION_KEY !== "";
