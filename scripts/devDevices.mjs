import { execFileSync } from "node:child_process";
import { androidEnv } from "./androidSdk.mjs";
import { sumSubtree } from "./devProcessTable.mjs";
import { AVDS, branchForWorktree } from "./devRegistry.mjs";

const EMULATOR_COMM = /qemu-system|\/emulator\/emulator$/;

export function parseAdbDevices(output) {
  return output
    .split("\n")
    .filter((line) => /^emulator-\d+\s+device\b/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

// One bounded `adb devices` call and nothing else. Resolving a serial to
// its AVD name would mean `adb -s <serial> emu avd name` per device, and
// a hung emulator answers that never — which is exactly why the serial is
// recorded on the lease at take time (devRegistry.recordDeviceSerial)
// instead of being re-derived here.
export function readAdbSerials({ exec = execFileSync, timeoutMs = 5000 } = {}) {
  try {
    const output = exec("adb", ["devices"], {
      encoding: "utf8",
      timeout: timeoutMs,
      env: { ...process.env, ...androidEnv(), LC_ALL: "C" },
    });
    return parseAdbDevices(output ?? "");
  } catch {
    return [];
  }
}

// `ps -o command` for the whole table would be unusable — one Electron
// process prints ~6 KB of flags — but it is the only place the AVD name
// appears, so it is read for emulator pids alone.
export function readCommandForPid(pid, exec = execFileSync) {
  try {
    return exec("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
  } catch {
    return undefined;
  }
}

function avdForPid(pid, commandForPid) {
  const match = /-avd\s+(\S+)/.exec(commandForPid(pid) ?? "");
  return match ? match[1] : undefined;
}

export function collectDevices({ registry, rows = [], commandForPid = readCommandForPid, now = Date.now() }) {
  // A booted emulator's launcher and its qemu-system child can both match
  // EMULATOR_COMM as separate pids (rather than the launcher exec'ing into
  // the child) — if both were treated as subtree roots, the child's memory
  // would be summed twice: once on its own and once inside the launcher's
  // subtree. Only rows whose ppid is NOT itself a matching emulator row are
  // treated as roots, so a child already covered by its parent's subtree is
  // skipped.
  const emulatorPids = new Set(rows.filter((row) => EMULATOR_COMM.test(row.comm)).map((row) => row.pid));
  const rssKBByAvd = {};
  for (const row of rows) {
    if (!emulatorPids.has(row.pid) || emulatorPids.has(row.ppid)) continue;
    const avd = avdForPid(row.pid, commandForPid);
    if (avd === undefined) continue;
    rssKBByAvd[avd] = (rssKBByAvd[avd] ?? 0) + sumSubtree(row.pid, rows).rssKB;
  }

  return AVDS.map((avd) => {
    const lease = registry.devices[avd] ?? null;
    const rssKB = rssKBByAvd[avd];
    const takenAtMs = lease?.takenAt ? Date.parse(lease.takenAt) : NaN;
    return {
      avd,
      serial: lease?.serial ?? null,
      holder: lease ? (branchForWorktree(registry, lease.worktree) ?? lease.worktree) : null,
      worktree: lease?.worktree ?? null,
      takenAt: lease?.takenAt ?? null,
      heldMs: Number.isFinite(takenAtMs) ? now - takenAtMs : null,
      rssMB: rssKB === undefined ? null : Math.round(rssKB / 1024),
    };
  });
}

export function orphanSerials(registry, serials) {
  const leased = new Set(
    Object.values(registry.devices)
      .map((lease) => lease?.serial)
      .filter(Boolean),
  );
  return serials.filter((serial) => !leased.has(serial));
}
