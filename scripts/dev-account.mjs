#!/usr/bin/env node
// Seeds (or resets) a dedicated local dev account for on-emulator testing —
// see mobile/README.md's "Testing on an emulator" section. Never touches a
// real account or a real .env: it only ever writes into THIS checkout's own
// backend/data/dev/*.sqlite and mobile/.env.local, both gitignored.
//
// What it does:
//   1. If this worktree has no backend/.env yet (a fresh worktree — .env is
//      gitignored, so every worktree needs its own), generates one from
//      backend/.env.example with fresh random JWT secrets. Every other
//      field stays at .env.example's own default (LAN/OAuth/socials all
//      stay off, same as a normal fresh checkout).
//   2. points every *_DB_PATH/*_STORAGE_PATH at backend/data/dev/ (see
//      devDataDir.mjs) instead of backend/.env's own paths — so this never
//      touches a developer's own backend/data/*.sqlite, and so the server
//      scripts/dev-emulator.mjs starts afterward (with the same overrides)
//      reads the very database this just wrote.
//   3. signs up (or, on a re-run, logs in as) a fixed local-only account —
//      backend/src/modules/auth/service.ts directly, no HTTP — so the
//      refresh token is real, correctly hashed, and stays valid for
//      whatever backend/src/config/env.ts's ACCESS/REFRESH_TOKEN_TTL says.
//   4. writes the fixture library (scripts/fixtures/library.json) straight
//      into library_documents — a raw row, not a request: that table is an
//      opaque per-user blob (see its own schema.sql), so there's no
//      service logic worth going through for it. Only on first creation,
//      or with --reset: a plain re-run leaves an existing account's
//      library alone so testing progress survives.
//   5. writes the refresh token into mobile/.env.local as
//      EXPO_PUBLIC_DEV_REFRESH_TOKEN, which mobile/src/core/devSession.ts
//      picks up on next boot (dev builds only — see that file's own
//      comment for why this can't reach a release build); also fills in
//      EXPO_PUBLIC_API_URL with a localhost default, but only when absent
//      — never clobbering a phone tester's own LAN IP.
//
// Idempotent: re-running logs back into the same account without touching
// its library (pass --reset to force the library back to the fixture's
// known state). Run directly (`node --import tsx scripts/dev-account.mjs`
// — plain `node` fails with ERR_MODULE_NOT_FOUND, since this imports
// backend .ts sources) or via scripts/dev-emulator.mjs, which calls this
// first.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devDataDir, devDataDirEnv } from "./devDataDir.mjs";
import { defaultEnvLine, upsertEnvLine } from "./devEnvFile.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendDir = join(repoRoot, "backend");

export const DEV_EMAIL = "scripta-dev@local.test";
export const DEV_USERNAME = "scripta_dev";
// Not a real secret — a fixed, committed-in-source password for a
// synthetic local-only account with fixture data, scoped to this
// worktree's own backend/data/dev/auth.sqlite. Fixed (not random) on
// purpose: it's what lets a re-run log back into the SAME account instead
// of needing to remember or persist a generated one.
export const DEV_PASSWORD = "scripta-dev-local-only";

const flags = new Set(process.argv.slice(2));
const forceReset = flags.has("--reset");

// Exported so dev-emulator.mjs's claimThisWorktree() can call this BEFORE
// applySlotEnv() writes the slot's PORT/FRONTEND_URL — otherwise
// applySlotEnv's upsertEnvLine would itself create backend/.env (with
// only those two keys) on a fresh worktree, and the existsSync check
// below would then see a file already there and skip generating the
// JWT secrets entirely. `dir` defaults to this module's own backendDir
// (main()'s normal call, and a bare `node scripts/dev-account.mjs`) but
// takes an explicit dir so tests can point it at a temp directory
// instead of this repo's real backend/.env.
export function ensureBackendEnv(dir = backendDir) {
  const envPath = join(dir, ".env");
  if (existsSync(envPath)) return;
  const examplePath = join(dir, ".env.example");
  const secret = () => randomBytes(48).toString("hex");
  const filled = readFileSync(examplePath, "utf8")
    .replace(
      "JWT_ACCESS_SECRET=replace-me-with-a-random-64-char-hex-string",
      `JWT_ACCESS_SECRET=${secret()}`,
    )
    .replace(
      "JWT_REFRESH_SECRET=replace-me-with-a-different-random-64-char-hex-string",
      `JWT_REFRESH_SECRET=${secret()}`,
    );
  writeFileSync(envPath, filled);
  console.log(`Generated ${envPath} (fresh JWT secrets; everything else at .env.example's defaults — no OAuth/socials).`);
}

async function main() {
  ensureBackendEnv();

  // Dynamic imports, AFTER ensureBackendEnv and AFTER the chdir below:
  // config/env.ts runs `dotenv/config` (cwd-relative) at import time, so
  // backend/.env must both exist and be the cwd's .env before anything
  // that transitively imports env.ts is loaded.
  process.chdir(backendDir);

  // Must also come before those dynamic imports, and specifically before
  // dotenv/config runs inside them: dotenv (v16, default options) never
  // overrides a key already present in process.env, so setting these here
  // first is what makes them win over whatever backend/.env says, not the
  // reverse.
  mkdirSync(devDataDir, { recursive: true });
  Object.assign(process.env, devDataDirEnv());

  const { openAuthDb } = await import("../backend/src/modules/auth/adapters/sqlite/connection.js");
  const { createSqliteAuthRepository } = await import("../backend/src/modules/auth/adapters/sqlite/sqliteAuthRepository.js");
  const { createFsAvatarBlobStore } = await import("../backend/src/modules/auth/adapters/fs/avatarBlobStore.js");
  const { createAuthService } = await import("../backend/src/modules/auth/service.js");
  const { EmailInUseError, UsernameInUseError } = await import("../backend/src/modules/auth/domain/errors.js");
  const { openLibraryDb } = await import("../backend/src/modules/library/adapters/sqlite/connection.js");
  const { env } = await import("../backend/src/config/env.js");

  const authDb = openAuthDb();
  const authRepository = createSqliteAuthRepository(authDb);
  const avatarStore = createFsAvatarBlobStore(env.AVATAR_STORAGE_PATH);
  const authService = createAuthService(authRepository, avatarStore);

  let user;
  let tokens;
  let created;
  try {
    ({ user, tokens } = await authService.signup(DEV_EMAIL, DEV_USERNAME, DEV_PASSWORD));
    created = true;
  } catch (error) {
    if (error instanceof EmailInUseError || error instanceof UsernameInUseError) {
      ({ user, tokens } = await authService.login(DEV_EMAIL, DEV_PASSWORD));
      created = false;
    } else {
      throw error;
    }
  }
  authDb.close();

  let bookCount = null;
  if (created || forceReset) {
    const fixturePath = join(repoRoot, "scripts", "fixtures", "library.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const libraryDb = openLibraryDb();
    libraryDb
      .prepare(
        `INSERT INTO library_documents (user_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(user.id, JSON.stringify(fixture), new Date().toISOString());
    libraryDb.close();
    bookCount = fixture.books.length;
  }

  const mobileDir = join(repoRoot, "mobile");
  mkdirSync(mobileDir, { recursive: true });
  const mobileEnvPath = join(mobileDir, ".env.local");
  upsertEnvLine(mobileEnvPath, "EXPO_PUBLIC_DEV_REFRESH_TOKEN", tokens.refreshToken);
  defaultEnvLine(mobileEnvPath, "EXPO_PUBLIC_API_URL", "http://127.0.0.1:3000");

  if (bookCount !== null) {
    console.log(`${created ? "Created" : "Reset"} dev account ${DEV_EMAIL} (user ${user.id}) with the ${bookCount}-book fixture library.`);
  } else {
    console.log(`Signed back into dev account ${DEV_EMAIL} (user ${user.id}); library left untouched (pass --reset to reseed it).`);
  }
  console.log("mobile/.env.local now has EXPO_PUBLIC_DEV_REFRESH_TOKEN set.");
}

// Guarded: dev-emulator.mjs imports this module just for the DEV_EMAIL /
// DEV_PASSWORD constants (for its own login probe), and must not trigger
// a full seeding run as a side effect of that import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
