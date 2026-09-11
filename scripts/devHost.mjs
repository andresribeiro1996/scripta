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

// os.freemem() on macOS is the wrong number to gate on. It reports only
// pages the kernel has not touched at all since boot — not memory you
// could actually have back. macOS deliberately keeps almost all RAM
// populated as file-backed cache and treats that as available-on-demand
// (Activity Monitor's "Available" = free + inactive + speculative +
// purgeable), so freemem() alone reads as near-zero on a perfectly
// healthy box. Measured on a real 32 GB machine mid-development:
// os.freemem() = 0.17 GB, while `memory_pressure` reported 49% of all
// system memory free and `vm_stat` broke down to roughly 7.9 GB
// genuinely available (free 154 MB + inactive 7.7 GB + speculative
// 31 MB + purgeable 13 MB). Gating on freemem() alone made the 4 GB
// threshold in DEFAULT_LIMITS fire unconditionally, so nothing could
// ever boot. Do not "simplify" this back to freemem() on Darwin.
//
// Parses `vm_stat`'s own header for the page size ("page size of N
// bytes") rather than assuming 4096 (Intel) or 16384 (Apple Silicon) —
// it differs by hardware and vm_stat always states which one it used.
// Returns a byte count, or a falsy value (undefined) if the output
// doesn't match the shape this expects, so callers can fall back.
export function parseVmStatAvailableBytes(output) {
  if (typeof output !== "string") return undefined;
  const pageSizeMatch = output.match(/page size of (\d+) bytes/);
  if (!pageSizeMatch) return undefined;
  const pageSize = Number(pageSizeMatch[1]);

  const pageCount = (label) => {
    const match = output.match(new RegExp(`Pages ${label}:\\s*(\\d+)\\.`));
    return match ? Number(match[1]) : undefined;
  };
  const free = pageCount("free");
  const inactive = pageCount("inactive");
  const speculative = pageCount("speculative");
  const purgeable = pageCount("purgeable");
  if (
    !Number.isFinite(pageSize) ||
    !Number.isFinite(free) ||
    !Number.isFinite(inactive) ||
    !Number.isFinite(speculative) ||
    !Number.isFinite(purgeable)
  ) {
    return undefined;
  }
  return (free + inactive + speculative + purgeable) * pageSize;
}

// The production reading of host state. Kept separate from
// assertResourcesAvailable so tests inject `host` instead of depending on
// the real machine.
//
// On Darwin, freeBytes comes from `vm_stat` ("available" memory — see
// parseVmStatAvailableBytes above), not os.freemem(); everywhere else,
// and if vm_stat is missing or its output doesn't parse, this falls back
// to os.freemem() so a measurement hiccup degrades gracefully instead of
// blocking every boot (or worse, throwing).
export function readHost() {
  let freeBytes = freemem();
  if (process.platform === "darwin") {
    try {
      const vmStatOutput = execFileSync("vm_stat", [], { encoding: "utf8" });
      const availableBytes = parseVmStatAvailableBytes(vmStatOutput);
      if (Number.isFinite(availableBytes)) {
        freeBytes = availableBytes;
      }
    } catch {
      // vm_stat missing, unreadable, or unparseable — keep the
      // os.freemem() fallback already assigned above.
    }
  }
  return { freeBytes, loadAvg1: loadavg()[0] };
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
    throw new Error(`only ${freeGB} GB of memory available (need ${minGB} GB) — close something before booting another stack.`);
  }
  if (wantsSecondEmulator && host.loadAvg1 > limits.maxLoadForSecondEmulator) {
    throw new Error(
      `1-minute load average is ${host.loadAvg1.toFixed(1)} (limit ${limits.maxLoadForSecondEmulator}) — ` +
        "a second emulator would contend for CPU. Wait, or use the one already running.",
    );
  }
}
