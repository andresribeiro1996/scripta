// The adb reverse tunnels that make an emulator's own 127.0.0.1 resolve
// to this machine, and the check for whether they are still up.
//
// They do not stay up on their own: `adb root` restarts adbd and drops
// every reverse mapping, and so does unplugging or rebooting the device.
// Nothing notices until the app fails to reach Metro or the API minutes
// later, which is why dev:status reports them and `npm run dev:tunnels`
// puts them back.

import { execFileSync } from "node:child_process";
import { androidEnv } from "./androidSdk.mjs";

// Only these two are ever tunnelled: the browser reaches vite directly
// over the LAN, so a vite tunnel would be a mapping nothing uses — and a
// warning about its absence would be one nobody could act on.
export const TUNNELLED_ROLES = ["backend", "metro"];

// dev-emulator.mjs only ever maps tcp:N to the same tcp:N, so a port
// number appearing anywhere on a line means that tunnel is up. Matching
// the number rather than the mapping's shape keeps this robust to adb's
// output format, which differs between platform-tools versions.
export function parseReverseList(output) {
  const ports = new Set();
  for (const match of output.matchAll(/tcp:(\d+)/g)) ports.add(Number(match[1]));
  return [...ports];
}

export function missingTunnels(ports, present) {
  return TUNNELLED_ROLES.flatMap((role) => (present.includes(ports[role]) ? [] : [[role, ports[role]]]));
}

// Bounded and never throwing, like every other external call this tool
// makes: a hung or vanished emulator degrades to "no tunnels known"
// rather than aborting the snapshot.
export function readReverseList(serial, { exec = execFileSync, timeoutMs = 5000 } = {}) {
  try {
    const output = exec("adb", ["-s", serial, "reverse", "--list"], {
      encoding: "utf8",
      timeout: timeoutMs,
      env: { ...process.env, ...androidEnv(), LC_ALL: "C" },
    });
    return parseReverseList(output ?? "");
  } catch {
    return [];
  }
}

// Re-applies a mapping. adb reverse is idempotent — repeating one that
// already exists replaces it rather than erroring — so the caller need
// not check first.
export function applyTunnel(serial, port, { exec = execFileSync, timeoutMs = 5000 } = {}) {
  exec("adb", ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, ...androidEnv(), LC_ALL: "C" },
  });
}
