import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_SLOT, portsForSlot, readRegistry, withLock, writeRegistry } from "./devRegistry.mjs";
import { claimSlot, releaseSlot, slotForWorktree } from "./devRegistry.mjs";

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

const allFree = () => true;

function claim(path, worktree, extra = {}) {
  return claimSlot({
    path,
    worktree,
    branch: "b",
    pid: process.pid,
    session: null,
    isPrimary: false,
    isPortFree: allFree,
    ...extra,
  });
}

test("the primary checkout always takes slot 0", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    const primary = claim(path, "/repo", { isPrimary: true });
    assert.equal(primary.slot, 0);
    assert.deepEqual(primary.ports, { backend: 3000, vite: 5173, metro: 8081 });
  });
});

test("a non-primary worktree never takes slot 0", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(claim(path, "/wt/a").slot, 1);
  });
});

test("claiming twice from the same worktree reuses its slot", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(claim(path, "/wt/a").slot, claim(path, "/wt/a").slot);
  });
});

test("slots are handed out lowest-free-first, reusing released gaps", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    claim(path, "/wt/b");
    claim(path, "/wt/c");
    releaseSlot({ path, worktree: "/wt/b" });
    assert.equal(claim(path, "/wt/d").slot, 2);
  });
});

test("a slot whose pid is dead is reclaimable", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a", { pid: 2147483646 });
    assert.equal(claim(path, "/wt/b").slot, 1);
  });
});

test("a slot whose pid is alive is not reclaimable", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    assert.equal(claim(path, "/wt/b").slot, 2);
  });
});

test("a slot whose ports are externally occupied is skipped with a warning", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const busyOnSlotOne = (port) => port !== 3100;
    const result = claim(path, "/wt/a", { isPortFree: busyOnSlotOne });
    assert.equal(result.slot, 2);
  });
});

test("releaseSlot removes only that worktree's entry", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    claim(path, "/wt/b");
    releaseSlot({ path, worktree: "/wt/a" });
    const registry = readRegistry(path);
    assert.equal(slotForWorktree(registry, "/wt/a"), undefined);
    assert.equal(slotForWorktree(registry, "/wt/b"), "2");
  });
});

test("running out of slots throws", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    for (let i = 1; i <= MAX_SLOT; i += 1) claim(path, `/wt/${i}`);
    assert.throws(() => claim(path, "/wt/overflow"), /no free slot/);
  });
});
