import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_SLOT, portsForSlot, readRegistry, withLock, writeRegistry } from "./devRegistry.mjs";

test("slot 0 keeps the familiar default ports", () => {
  assert.deepEqual(portsForSlot(0), { backend: 3000, vite: 5173, metro: 8081 });
});

test("each slot shifts every port by 100", () => {
  assert.deepEqual(portsForSlot(2), { backend: 3200, vite: 5373, metro: 8281 });
});

test("the last slot stays inside its range", () => {
  assert.deepEqual(portsForSlot(MAX_SLOT), { backend: 4500, vite: 6673, metro: 9581 });
});

test("a slot outside 0..MAX_SLOT is rejected", () => {
  assert.throws(() => portsForSlot(-1), /slot/);
  assert.throws(() => portsForSlot(MAX_SLOT + 1), /slot/);
});

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-devRegistry-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readRegistry returns an empty registry when the file is absent", () => {
  withTempDir((dir) => {
    const registry = readRegistry(join(dir, "scripta-dev.json"));
    assert.equal(registry.version, 1);
    assert.deepEqual(registry.slots, {});
    assert.deepEqual(registry.devices, { "scripta-dev-0": null, "scripta-dev-1": null });
  });
});

test("readRegistry returns an empty registry when the file is corrupt", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    writeFileSync(path, "{ not json");
    assert.deepEqual(readRegistry(path).slots, {});
  });
});

test("writeRegistry round-trips through readRegistry", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const registry = readRegistry(path);
    registry.slots["2"] = { worktree: "/tmp/wt", branch: "x", pid: 1, session: null, claimedAt: "t" };
    writeRegistry(path, registry);
    assert.equal(readRegistry(path).slots["2"].branch, "x");
    assert.match(readFileSync(path, "utf8"), /\n$/);
  });
});

test("withLock releases the lock so a second call succeeds", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(withLock(path, () => "first"), "first");
    assert.equal(withLock(path, () => "second"), "second");
  });
});

test("withLock releases the lock even when the callback throws", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.throws(() => withLock(path, () => { throw new Error("boom"); }), /boom/);
    assert.equal(withLock(path, () => "after"), "after");
  });
});

test("withLock breaks a lock older than the stale timeout", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    writeFileSync(`${path}.lock`, "99999");
    const old = Date.now() / 1000 - 30;
    utimesSync(`${path}.lock`, old, old);
    assert.equal(withLock(path, () => "broke through"), "broke through");
  });
});
