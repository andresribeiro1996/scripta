import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { test } from "node:test";
import { DEFAULT_LIMITS, assertResourcesAvailable, worktreeIdentity } from "./devHost.mjs";

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
