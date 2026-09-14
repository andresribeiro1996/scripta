import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applySlotEnv } from "./devSlotEnv.mjs";

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-slotEnv-"));
  for (const sub of ["backend", "frontend", "mobile"]) mkdirSync(join(dir, sub));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const slotTwo = { backend: 3200, vite: 5373, metro: 8281 };

test("all six values land in their own files", () => {
  withRepo((repoRoot) => {
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });
    const backend = readFileSync(join(repoRoot, "backend", ".env"), "utf8");
    assert.match(backend, /^PORT=3200$/m);
    assert.match(backend, /^FRONTEND_URL=http:\/\/localhost:5373$/m);
    const frontend = readFileSync(join(repoRoot, "frontend", ".env.local"), "utf8");
    assert.match(frontend, /^VITE_API_PORT=3200$/m);
    assert.match(frontend, /^VITE_PORT=5373$/m);
    assert.match(readFileSync(join(repoRoot, "mobile", ".env.local"), "utf8"), /^EXPO_PUBLIC_API_URL=http:\/\/127\.0\.0\.1:3200$/m);
  });
});

test("lan transport substitutes the host address in the mobile URL only", () => {
  withRepo((repoRoot) => {
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "lan", lanAddress: "192.168.1.24" });
    assert.match(readFileSync(join(repoRoot, "mobile", ".env.local"), "utf8"), /^EXPO_PUBLIC_API_URL=http:\/\/192\.168\.1\.24:3200$/m);
    assert.match(readFileSync(join(repoRoot, "backend", ".env"), "utf8"), /^FRONTEND_URL=http:\/\/localhost:5373$/m);
  });
});

test("lan transport without an address is refused", () => {
  withRepo((repoRoot) => {
    assert.throws(() => applySlotEnv({ repoRoot, ports: slotTwo, transport: "lan" }), /lan address/i);
  });
});

test("re-applying a different slot replaces the previous values", () => {
  withRepo((repoRoot) => {
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });
    applySlotEnv({ repoRoot, ports: { backend: 3300, vite: 5473, metro: 8381 }, transport: "loopback" });
    const backend = readFileSync(join(repoRoot, "backend", ".env"), "utf8");
    assert.match(backend, /^PORT=3300$/m);
    assert.doesNotMatch(backend, /^PORT=3200$/m);
    const frontend = readFileSync(join(repoRoot, "frontend", ".env.local"), "utf8");
    assert.match(frontend, /^VITE_PORT=5473$/m);
    assert.doesNotMatch(frontend, /^VITE_PORT=5373$/m);
  });
});

test("existing unrelated keys survive", () => {
  withRepo((repoRoot) => {
    const backendEnv = join(repoRoot, "backend", ".env");
    writeFileSync(backendEnv, "JWT_ACCESS_SECRET=abc123\n");
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });
    const backend = readFileSync(backendEnv, "utf8");
    assert.match(backend, /^JWT_ACCESS_SECRET=abc123$/m);
    assert.match(backend, /^PORT=3200$/m);
  });
});
