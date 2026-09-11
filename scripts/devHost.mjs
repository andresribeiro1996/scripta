// Host-side facts the slot registry needs but cannot know: whether a port
// is actually free, which worktree this is, and whether the machine has
// room for another stack.

import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { freemem, loadavg } from "node:os";

export const DEFAULT_LIMITS = {
  maxStacks: 4,
  minFreeBytes: 4 * 1024 ** 3,
  maxLoadForSecondEmulator: 8,
};

// Async, unlike devRegistry.mjs's claimSlot predicate: this opens a real
// socket, so callers must await it and pass the resolved (sync) result
// through — see probePorts below and Task 8, which bridges the two.
//
// Dialing 127.0.0.1 alone is not enough: Vite has been observed binding
// only [::1] (IPv6 loopback, not dual-stack), and backend/src/server.ts
// binds "::" outright. Either can leave a real listener that an
// IPv4-only probe walks right past, reporting the port free when it is
// not. So a port only counts as free when BOTH loopback families refuse
// the connection; either one accepting means something is there.
function probeLoopback(port, host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const finish = (occupied) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.once("connect", () => finish(true));
    // Any connect error means "nothing reachable there" for this family,
    // never something to propagate: a refused connection is the normal
    // free-port case, and a host with no IPv6 loopback at all fails the
    // same way (EAFNOSUPPORT/ENETUNREACH/EADDRNOTAVAIL) — both read as
    // "not occupied", not as an error to surface.
    socket.once("error", () => finish(false));
  });
}

export async function isPortFree(port) {
  const [v4Occupied, v6Occupied] = await Promise.all([
    probeLoopback(port, "127.0.0.1"),
    probeLoopback(port, "::1"),
  ]);
  return !v4Occupied && !v6Occupied;
}

export async function probePorts(ports) {
  const entries = await Promise.all(ports.map(async (port) => [port, await isPortFree(port)]));
  return Object.fromEntries(entries);
}

// `worktree` is git's own absolute path for this checkout (--show-toplevel),
// `isPrimary` compares it against the first entry of `git worktree list`,
// which is always the primary checkout, listed first, never a linked one.
export function worktreeIdentity(cwd = process.cwd()) {
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const worktree = git(["rev-parse", "--show-toplevel"]);
  const branch = git(["branch", "--show-current"]) || "(detached)";
  const primary = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  return { worktree, branch, isPrimary: worktree === primary };
}

// The production reading of host state. Kept separate from
// assertResourcesAvailable so tests inject `host` instead of depending on
// the real machine.
export function readHost() {
  return { freeBytes: freemem(), loadAvg1: loadavg()[0] };
}

export function assertResourcesAvailable({ stackCount, limits, host, wantsSecondEmulator = false }) {
  if (stackCount >= limits.maxStacks) {
    throw new Error(
      `${stackCount} stacks are already running (limit ${limits.maxStacks}) — ` +
        "tear one down, or run `npm run dev:status` to see which.",
    );
  }
  if (host.freeBytes < limits.minFreeBytes) {
    const freeGB = (host.freeBytes / 1024 ** 3).toFixed(1);
    const minGB = (limits.minFreeBytes / 1024 ** 3).toFixed(0);
    throw new Error(`only ${freeGB} GB of memory free (need ${minGB} GB) — close something before booting another stack.`);
  }
  if (wantsSecondEmulator && host.loadAvg1 > limits.maxLoadForSecondEmulator) {
    throw new Error(
      `1-minute load average is ${host.loadAvg1.toFixed(1)} (limit ${limits.maxLoadForSecondEmulator}) — ` +
        "a second emulator would contend for CPU. Wait, or use the one already running.",
    );
  }
}
