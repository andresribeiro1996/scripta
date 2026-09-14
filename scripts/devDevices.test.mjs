import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDevices, orphanSerials, parseAdbDevices } from "./devDevices.mjs";

const NOW = Date.parse("2026-09-14T15:00:00.000Z");

function registryWithLease(extra = {}) {
  return {
    version: 1,
    slots: { 5: { worktree: "/wt/5a", branch: "mobile/5a-library", pid: 1, session: "5a-library", claimedAt: "x" } },
    devices: {
      "scripta-dev-0": { worktree: "/wt/5a", pid: 1, takenAt: "2026-09-14T14:42:00.000Z", serial: "emulator-5554" },
      "scripta-dev-1": null,
      ...extra,
    },
  };
}

test("parseAdbDevices keeps only serials in device state", () => {
  const output = ["List of devices attached", "emulator-5554\tdevice", "emulator-5556\toffline", ""].join("\n");
  assert.deepEqual(parseAdbDevices(output), ["emulator-5554"]);
});

test("a held device reports its serial and holding branch from the registry", () => {
  const [held] = collectDevices({ registry: registryWithLease(), now: NOW });
  assert.equal(held.avd, "scripta-dev-0");
  assert.equal(held.serial, "emulator-5554");
  assert.equal(held.holder, "mobile/5a-library");
  assert.equal(held.heldMs, 18 * 60 * 1000);
});

test("a free AVD is still listed, with nulls", () => {
  const free = collectDevices({ registry: registryWithLease(), now: NOW })[1];
  assert.deepEqual(free, { avd: "scripta-dev-1", serial: null, holder: null, worktree: null, takenAt: null, heldMs: null, rssMB: null });
});

test("a lease whose worktree holds no slot falls back to the worktree path", () => {
  const registry = registryWithLease();
  registry.slots = {};
  assert.equal(collectDevices({ registry, now: NOW })[0].holder, "/wt/5a");
});

test("emulator memory is summed over the qemu subtree and matched by -avd", () => {
  const rows = [
    { pid: 700, ppid: 1, rss: 2_097_152, cpu: 30, comm: "/opt/android/emulator/qemu/darwin-aarch64/qemu-system-aarch64" },
    { pid: 701, ppid: 700, rss: 1_048_576, cpu: 5, comm: "/opt/android/emulator/qemu/darwin-aarch64/qemu-system-aarch64" },
  ];
  const commandForPid = (pid) => (pid === 700 ? "qemu-system-aarch64 -avd scripta-dev-0 -no-audio" : undefined);
  const [held] = collectDevices({ registry: registryWithLease(), rows, commandForPid, now: NOW });
  assert.equal(held.rssMB, 3072);
});

test("an emulator whose AVD cannot be resolved contributes no memory", () => {
  const rows = [{ pid: 700, ppid: 1, rss: 2_097_152, cpu: 30, comm: "/opt/android/emulator/qemu/darwin-aarch64/qemu-system-aarch64" }];
  const [held] = collectDevices({ registry: registryWithLease(), rows, commandForPid: () => undefined, now: NOW });
  assert.equal(held.rssMB, null);
});

test("a launcher and its qemu child both matching the emulator pattern are counted once", () => {
  const rows = [
    { pid: 700, ppid: 1, rss: 2_097_152, cpu: 30, comm: "/opt/homebrew/share/android-commandlinetools/emulator/emulator" },
    { pid: 701, ppid: 700, rss: 1_048_576, cpu: 5, comm: "/opt/android/emulator/qemu/darwin-aarch64/qemu-system-aarch64" },
  ];
  const commandForPid = () => "qemu-system-aarch64 -avd scripta-dev-0 -no-audio";
  const [held] = collectDevices({ registry: registryWithLease(), rows, commandForPid, now: NOW });
  assert.equal(held.rssMB, 3072);
});

test("a lease with an unparseable takenAt degrades heldMs to null, not NaN", () => {
  const registry = registryWithLease({
    "scripta-dev-0": { worktree: "/wt/5a", pid: 1, takenAt: "not-a-date", serial: "emulator-5554" },
  });
  const [held] = collectDevices({ registry, now: NOW });
  assert.equal(held.heldMs, null);
});

test("a running serial that matches no lease is an orphan", () => {
  assert.deepEqual(orphanSerials(registryWithLease(), ["emulator-5554", "emulator-5556"]), ["emulator-5556"]);
});
