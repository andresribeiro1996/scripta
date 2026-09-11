import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { freemem } from "node:os";
import { isAbsolute } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_LIMITS,
  assertResourcesAvailable,
  isPortFree,
  parseVmStatAvailableBytes,
  probePorts,
  readHost,
  worktreeIdentity,
} from "./devHost.mjs";

const roomy = { freeBytes: 16 * 1024 ** 3, loadAvg1: 1 };

test("a roomy host passes", () => {
  assertResourcesAvailable({ stackCount: 1, limits: DEFAULT_LIMITS, host: roomy });
});

test("too many stacks is refused, naming the limit", () => {
  assert.throws(
    () => assertResourcesAvailable({ stackCount: 4, limits: DEFAULT_LIMITS, host: roomy }),
    /4 stacks/,
  );
});

test("low free memory is refused", () => {
  assert.throws(
    () => assertResourcesAvailable({
      stackCount: 0,
      limits: DEFAULT_LIMITS,
      host: { freeBytes: 2 * 1024 ** 3, loadAvg1: 1 },
    }),
    /memory/i,
  );
});

test("a second emulator is refused under high load", () => {
  assert.throws(
    () => assertResourcesAvailable({
      stackCount: 0,
      limits: DEFAULT_LIMITS,
      host: { freeBytes: 16 * 1024 ** 3, loadAvg1: 9 },
      wantsSecondEmulator: true,
    }),
    /load/i,
  );
});

test("high load alone does not block a stack", () => {
  assertResourcesAvailable({
    stackCount: 0,
    limits: DEFAULT_LIMITS,
    host: { freeBytes: 16 * 1024 ** 3, loadAvg1: 9 },
  });
});

test("worktreeIdentity reports this repo's branch and primary-ness", () => {
  const identity = worktreeIdentity(process.cwd());
  assert.equal(typeof identity.worktree, "string");
  assert.equal(typeof identity.isPrimary, "boolean");

  // Strengthen beyond the brief's type-only check without hardcoding
  // anything environment-specific: `worktree` must be a real, absolute
  // path (git always reports it that way) ...
  assert.ok(isAbsolute(identity.worktree), "worktree should be an absolute path");
  assert.ok(existsSync(identity.worktree), "worktree path should exist on disk");

  // ... and isPrimary must agree with an independent derivation of the
  // same fact, so this holds whether the suite runs from the primary
  // checkout or any linked worktree — no assumption about which one this
  // happens to be.
  const cwd = process.cwd();
  const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  const firstWorktree = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" })
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  assert.equal(identity.isPrimary, toplevel === firstWorktree);
});

// Helper: listen on one loopback family only, on a high ephemeral-range
// port unlikely to clash with anything else on the box.
function listenOn(host, port) {
  return new Promise((resolve, reject) => {
    const server = createServer(() => {});
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("isPortFree is false when only 127.0.0.1 is listening", async () => {
  const port = 49213;
  const server = await listenOn("127.0.0.1", port);
  try {
    assert.equal(await isPortFree(port), false);
  } finally {
    await closeServer(server);
  }
});

// The regression test for the bug: an IPv4-only probe reports this port
// free because it only ever dials 127.0.0.1. Confirmed to fail against
// the shipped implementation before the fix.
test("isPortFree is false when only ::1 is listening", async () => {
  const port = 49214;
  const server = await listenOn("::1", port);
  try {
    assert.equal(await isPortFree(port), false);
  } finally {
    await closeServer(server);
  }
});

test("isPortFree is true when nothing is listening", async () => {
  const port = 49215;
  assert.equal(await isPortFree(port), true);
});

test("probePorts returns the correct boolean per port across a mixed set", async () => {
  const v4Port = 49216;
  const v6Port = 49217;
  const freePort = 49218;
  const v4Server = await listenOn("127.0.0.1", v4Port);
  const v6Server = await listenOn("::1", v6Port);
  try {
    const result = await probePorts([v4Port, v6Port, freePort]);
    assert.deepEqual(result, {
      [v4Port]: false,
      [v6Port]: false,
      [freePort]: true,
    });
  } finally {
    await closeServer(v4Server);
    await closeServer(v6Server);
  }
});

// Fixture: a real `vm_stat` capture from this machine (arm64, 16 KB pages).
// Pinned as text rather than shelled out to at test time, per the fix's
// requirement that the parser be unit-testable without touching the host.
const VM_STAT_SAMPLE = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4456.
Pages active:                                 514015.
Pages inactive:                               512377.
Pages speculative:                               593.
Pages throttled:                                   0.
Pages wired down:                             196948.
Pages purgeable:                                  36.
"Translation faults":                     2634220208.
Pages copy-on-write:                        88561654.
Pages zero filled:                        1414842328.
Pages reactivated:                         247093936.
Pages purged:                               43044411.
File-backed pages:                            247722.
Anonymous pages:                              779263.
Pages stored in compressor:                  2217672.
Pages occupied by compressor:                 827340.
Decompressions:                            169029133.
Compressions:                              197869480.
Pageins:                                    30430870.
Pageouts:                                     640639.
Swapins:                                      273296.
Swapouts:                                     706869.
`;

test("parseVmStatAvailableBytes reads the page size from the header and sums free+inactive+speculative+purgeable", () => {
  // page size 16384; free 4456 + inactive 512377 + speculative 593 + purgeable 36 = 517462 pages
  const expectedBytes = 517462 * 16384;
  assert.equal(parseVmStatAvailableBytes(VM_STAT_SAMPLE), expectedBytes);
});

test("parseVmStatAvailableBytes returns a falsy failure signal on malformed input", () => {
  assert.ok(!parseVmStatAvailableBytes("not vm_stat output at all"));
  assert.ok(!parseVmStatAvailableBytes(""));
  // Header present but the page lines it needs are missing.
  assert.ok(!parseVmStatAvailableBytes("Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"));
});

test("readHost reports substantially more available memory than os.freemem() on a healthy macOS box", { skip: process.platform !== "darwin" }, () => {
  const { freeBytes } = readHost();
  // freemem() on macOS reports only genuinely-unused pages, which is
  // typically well under 1 GB even on a healthy machine because macOS
  // keeps RAM populated as cache. `readHost()` must report the larger
  // "available" figure (free + inactive + speculative + purgeable), so
  // it should exceed freemem() by a wide margin — not just be >=.
  assert.ok(
    freeBytes > freemem() * 2,
    `expected readHost().freeBytes (${freeBytes}) to be substantially larger than os.freemem() (${freemem()})`,
  );
});
