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

  // The frontend's origin, for CORS — see app.ts. Also the base every
  // share link is built on top of — modules/murals/plugin.ts's and
  // modules/library/plugin.ts's own publicUrlFor both template a share
  // token onto this (e.g. `${FRONTEND_URL}/shared/murals/:token`), and
  // those are the exact links postToSocial (modules/socials) posts out to
  // X/Threads/etc. A dev Vite server defaults to 5173; change this once
  // the frontend is actually deployed somewhere else — getting this wrong
  // in production means share links (and anything posted to social) point
  // at localhost.
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  // Widens CORS to accept any private-network origin (192.168.x.x,
  // 10.x.x.x, 172.16–31.x.x, loopback) on top of FRONTEND_URL above —
  // see config/corsOrigin.ts for why that's needed to open the app on a
  // phone over the LAN, and why it's opt-in rather than inferred. Set by
  // `npm run dev:mobile`; leave it out everywhere else, and never turn
  // it on in production.
  ALLOW_LAN_ORIGINS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Absolute paths to a TLS cert/key pair — set together or not at all
  // (config/devCerts.ts only trusts the pair, never one alone). When
  // both resolve to real files, app.ts serves the API over https instead
  // of http. Needed for testing "Add to Home Screen"/offline caching on
  // a phone: a service worker only runs in a secure context, and a LAN
  // address over plain http isn't one. `npm run dev:mobile` sets these
  // itself once you've run `node scripts/gen-mobile-certs.mjs` at the
  // repo root (see that script and frontend/vite.config.ts, which reads
  // the same pair for the frontend's own dev/preview servers) — nothing
  // to set here by hand, and blank in every real deployment.
  DEV_HTTPS_CERT_PATH: z.string().optional().default(""),
  DEV_HTTPS_KEY_PATH: z.string().optional().default(""),

  AUTH_DB_PATH: z.string().min(1),
  LIBRARY_DB_PATH: z.string().min(1),
  GALLERY_DB_PATH: z.string().min(1),
  // Where uploaded images are actually stored on disk, one subdirectory
  // per account — see modules/gallery/adapters/fs/fsImageBlobStore.ts.
  GALLERY_STORAGE_PATH: z.string().min(1),

  // modules/murals' own SQLite file — same one-file-per-module isolation as
  // every other module's *_DB_PATH above.
  MURALS_DB_PATH: z.string().min(1).default("./data/murals.sqlite"),

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
  // modules/arena's own SQLite file — same one-file-per-module isolation
  // as every other module's *_DB_PATH above.
  ARENA_DB_PATH: z.string().min(1).default("./data/arena.sqlite"),
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
