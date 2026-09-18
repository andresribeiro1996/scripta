import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_SLOT, portsForSlot, readRegistry, withLock, writeRegistry } from "./devRegistry.mjs";
import { claimSlot, isSlotLive, releaseSlot, slotForWorktree } from "./devRegistry.mjs";
import { AVDS, deviceHolders, recordDeviceSerial, releaseDevice, takeDevice } from "./devRegistry.mjs";

test("isSlotLive: a dead pid with an occupied port is live", () => {
  const occupied = (port) => port !== 3100;
  assert.equal(isSlotLive(1, { pid: 2147483646 }, occupied), true);
});

test("isSlotLive: a dead pid with all ports free is not live", () => {
  assert.equal(isSlotLive(1, { pid: 2147483646 }, () => true), false);
});

test("isSlotLive: a live pid is live even when its ports are free", () => {
  assert.equal(isSlotLive(1, { pid: process.pid }, () => true), true);
});

test("isSlotLive: no entry and free ports is not live", () => {
  assert.equal(isSlotLive(1, undefined, () => true), false);
});

test("isSlotLive: no entry but an externally occupied port is live", () => {
  const occupied = (port) => port !== 3100;
  assert.equal(isSlotLive(1, undefined, occupied), true);
});

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

test("writeRegistry is atomic: no stray temp file remains and content round-trips", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const registry = readRegistry(path);
    registry.slots["3"] = { worktree: "/tmp/atomic-wt", branch: "z", pid: 1, session: null, claimedAt: "t2" };
    writeRegistry(path, registry);
    assert.deepEqual(readdirSync(dir), ["scripta-dev.json"]);
    assert.equal(readRegistry(path).slots["3"].branch, "z");
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

test("a primary checkout can explicitly use a free alternate slot", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(claim(path, "/primary", { isPrimary: true, requestedSlot: 1, isPortFree: (port) => port !== 3000 }).slot, 1);
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

test("a dead pid whose ports are occupied is NOT handed to a different worktree", () => {
  // The worktree-port-lanes repro: dev-emulator.mjs spawns the backend and
  // Metro detached and exits, so the claiming pid is dead within seconds
  // while the stack it started keeps the ports bound. Pid-liveness alone
  // must not signal "this slot is free" when the ports say otherwise.
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const occupiedOnSlotOne = (port) => port !== 3100 && port !== 5273 && port !== 8181;
    claim(path, "/wt/a", { pid: 2147483646, isPortFree: occupiedOnSlotOne });
    assert.equal(claim(path, "/wt/b", { isPortFree: occupiedOnSlotOne }).slot, 2);
  });
});

test("a dead pid with all ports free is reclaimable", () => {
  // The recovery case this must keep working: a genuinely crashed
  // worktree's slot is freed once nothing is actually bound to its ports.
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a", { pid: 2147483646 });
    assert.equal(claim(path, "/wt/b").slot, 1);
  });
});

test("a live pid blocks reclaiming even when its ports are free", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    assert.equal(claim(path, "/wt/b").slot, 2);
  });
});

test("a worktree re-claiming its own slot reuses it even when its ports are occupied", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(claim(path, "/wt/a").slot, 1);
    // Now its own backend/Vite/Metro are bound to those ports — the
    // own-worktree match must short-circuit before any liveness check.
    const occupiedOnSlotOne = (port) => port !== 3100 && port !== 5273 && port !== 8181;
    assert.equal(claim(path, "/wt/a", { isPortFree: occupiedOnSlotOne }).slot, 1);
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

test("taking a device returns the first free AVD", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(takeDevice({ path, worktree: "/wt/a", pid: process.pid }).avd, AVDS[0]);
    assert.equal(takeDevice({ path, worktree: "/wt/b", pid: process.pid }).avd, AVDS[1]);
  });
});

test("taking a device twice from the same worktree is idempotent", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const first = takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    assert.equal(takeDevice({ path, worktree: "/wt/a", pid: process.pid }).avd, first.avd);
  });
});

test("taking a device when both are held names the holders", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    takeDevice({ path, worktree: "/wt/b", pid: process.pid });
    assert.throws(
      () => takeDevice({ path, worktree: "/wt/c", pid: process.pid }),
      /\/wt\/a[\s\S]*\/wt\/b/,
    );
  });
});

test("a lease whose pid is dead is reclaimable", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    takeDevice({ path, worktree: "/wt/a", pid: 2147483646 });
    takeDevice({ path, worktree: "/wt/b", pid: 2147483646 });
    assert.equal(takeDevice({ path, worktree: "/wt/c", pid: process.pid }).avd, AVDS[0]);
  });
});

test("a specific AVD can be requested", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(takeDevice({ path, worktree: "/wt/a", pid: process.pid, avd: AVDS[1] }).avd, AVDS[1]);
  });
});

test("releaseDevice frees only that worktree's lease", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    takeDevice({ path, worktree: "/wt/b", pid: process.pid });
    releaseDevice({ path, worktree: "/wt/a" });
    const holders = deviceHolders(readRegistry(path));
    assert.deepEqual(holders.map((holder) => holder.worktree), ["/wt/b"]);
  });
});

test("recordDeviceSerial round-trips through the registry", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const { avd } = takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    recordDeviceSerial({ path, worktree: "/wt/a", avd, serial: "emulator-5554" });
    const holders = deviceHolders(readRegistry(path));
    assert.equal(holders.find((holder) => holder.avd === avd).serial, "emulator-5554");
  });
});

test("recordDeviceSerial is a no-op when this worktree no longer holds the lease", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const { avd } = takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    releaseDevice({ path, worktree: "/wt/a" });
    // Must not resurrect a released lease, and must not throw.
    assert.doesNotThrow(() => recordDeviceSerial({ path, worktree: "/wt/a", avd, serial: "emulator-5554" }));
    assert.deepEqual(deviceHolders(readRegistry(path)), []);
  });
});

test("a lease with no recorded serial is handled without throwing", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const { avd } = takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    const holders = deviceHolders(readRegistry(path));
    assert.equal(holders.find((holder) => holder.avd === avd).serial, undefined);
  });
});
