// Small process-lifecycle helpers shared by dev-emulator.mjs and
// dev-phone.mjs: spawning a long-lived background dev server with its
// output captured to a log file, and polling until a condition holds.

import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { isPortFree } from "./devHost.mjs";

export function mkdirRuntimeDir(runtimeDir) {
  spawnSync("mkdir", ["-p", runtimeDir]);
}

/** Spawns a long-lived background process, stdout/stderr redirected to a
 *  log file under the OS tmpdir — never the repo. Detached + unref()'d so
 *  it outlives this script, matching how a developer would normally leave
 *  a dev server running in its own terminal tab. */
export function spawnDetached(command, args, { cwd, env, logName, runtimeDir }) {
  mkdirRuntimeDir(runtimeDir);
  const logPath = join(runtimeDir, logName);
  // Truncated ("w"), not appended: a stale log from a previous run (or a
  // previous invocation's failed attempt) must never be mistaken for
  // output from the process this call actually just started.
  const fd = openSync(logPath, "w");
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  return logPath;
}

export async function waitFor(check, { timeoutMs, intervalMs = 2000, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// devHost.mjs's isPortFree already probes both loopback families (Vite
// binds [::1] only; the backend binds "::") — this just inverts the sense
// for "is my own server already up" checks, rather than the codebase
// carrying a second, IPv4-only probe alongside it.
export async function isPortOpen(port) {
  return !(await isPortFree(port));
}
