import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ensureBackendEnv } from "./dev-account.mjs";
import { applySlotEnv } from "./devSlotEnv.mjs";

// The real backend/.env.example, copied into each temp repo — this is
// what gives ensureBackendEnv something to fill in, and keeps the
// fixture from drifting out of sync with the real file's defaults.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const realExample = readFileSync(join(repoRoot, "backend", ".env.example"), "utf8");

const slotTwo = { backend: 3200, vite: 5373, metro: 8281 };

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-devAccountEnv-"));
  for (const sub of ["backend", "frontend", "mobile"]) mkdirSync(join(dir, sub));
  writeFileSync(join(dir, "backend", ".env.example"), realExample);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("fresh worktree: ensureBackendEnv then applySlotEnv leaves JWT secrets AND the slot's PORT/FRONTEND_URL", () => {
  withRepo((repoRoot) => {
    const backendDir = join(repoRoot, "backend");
    const envPath = join(backendDir, ".env");

    // Mirrors claimThisWorktree()'s order: generate the baseline .env
    // first, THEN overlay the slot's values.
    ensureBackendEnv(backendDir);
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });

    const env = readFileSync(envPath, "utf8");

    const access = env.match(/^JWT_ACCESS_SECRET=(.+)$/m)?.[1];
    const refresh = env.match(/^JWT_REFRESH_SECRET=(.+)$/m)?.[1];
    assert.ok(access, "JWT_ACCESS_SECRET must be present");
    assert.ok(refresh, "JWT_REFRESH_SECRET must be present");
    assert.notEqual(access, "replace-me-with-a-random-64-char-hex-string");
    assert.notEqual(refresh, "replace-me-with-a-different-random-64-char-hex-string");
    assert.match(access, /^[0-9a-f]{96}$/);
    assert.match(refresh, /^[0-9a-f]{96}$/);
    assert.notEqual(access, refresh);

    assert.match(env, /^PORT=3200$/m);
    assert.match(env, /^FRONTEND_URL=http:\/\/localhost:5373$/m);
  });
});

test("fresh worktree: reversing the order (bug reproduction) leaves the JWT secrets missing", () => {
  withRepo((repoRoot) => {
    const backendDir = join(repoRoot, "backend");
    const envPath = join(backendDir, ".env");

    // applySlotEnv runs FIRST — this is what dev-emulator.mjs did before
    // the fix: its upsertEnvLine creates backend/.env with just PORT and
    // FRONTEND_URL, so ensureBackendEnv's existsSync check then sees a
    // file already there and returns early.
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });
    ensureBackendEnv(backendDir);

    const env = readFileSync(envPath, "utf8");
    assert.doesNotMatch(env, /^JWT_ACCESS_SECRET=/m);
    assert.doesNotMatch(env, /^JWT_REFRESH_SECRET=/m);
  });
});

test("existing worktree: a pre-set secret survives byte-for-byte and only PORT/FRONTEND_URL update", () => {
  withRepo((repoRoot) => {
    const backendDir = join(repoRoot, "backend");
    const envPath = join(backendDir, ".env");
    writeFileSync(
      envPath,
      [
        "PORT=9999",
        "FRONTEND_URL=http://localhost:9999",
        "JWT_ACCESS_SECRET=preexisting",
        "JWT_REFRESH_SECRET=preexisting-too",
      ].join("\n") + "\n",
    );

    ensureBackendEnv(backendDir);
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });

    const env = readFileSync(envPath, "utf8");
    assert.match(env, /^JWT_ACCESS_SECRET=preexisting$/m);
    assert.match(env, /^JWT_REFRESH_SECRET=preexisting-too$/m);
    assert.match(env, /^PORT=3200$/m);
    assert.match(env, /^FRONTEND_URL=http:\/\/localhost:5373$/m);
    assert.doesNotMatch(env, /^PORT=9999$/m);
  });
});

test("ensureBackendEnv is a no-op when backend/.env already exists (no secrets regenerated)", () => {
  withRepo((repoRoot) => {
    const backendDir = join(repoRoot, "backend");
    const envPath = join(backendDir, ".env");
    writeFileSync(envPath, "JWT_ACCESS_SECRET=fixed-value\n");

    ensureBackendEnv(backendDir);

    assert.equal(readFileSync(envPath, "utf8"), "JWT_ACCESS_SECRET=fixed-value\n");
  });
});
