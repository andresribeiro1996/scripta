import assert from "node:assert/strict";
import { test } from "node:test";
import { pidsToTeardown, teardownTargets } from "./devTeardown.mjs";

test("teardownTargets covers all three of the slot's ports, web included", () => {
  assert.deepEqual(teardownTargets({ backend: 3100, vite: 5273, metro: 8181 }), [
    ["backend", 3100],
    ["web", 5273],
    ["Metro", 8181],
  ]);
});

test("teardownTargets does not drop the web port", () => {
  const ports = { backend: 3100, vite: 5273, metro: 8181 };
  assert.ok(
    teardownTargets(ports).some(([, port]) => port === ports.vite),
    "a Vite left running holds the slot's web port while the registry reads the slot as free",
  );
});

const THIS_WORKTREE = "/Users/dev/scripta";

test("a candidate whose cwd is inside this worktree is killed", () => {
  const { toKill, toSkip } = pidsToTeardown([{ pid: 111, cwd: THIS_WORKTREE }], THIS_WORKTREE);
  assert.deepEqual(toKill, [111]);
  assert.deepEqual(toSkip, []);
});

test("a candidate whose cwd is a nested path under this worktree is killed", () => {
  const { toKill, toSkip } = pidsToTeardown([{ pid: 222, cwd: `${THIS_WORKTREE}/backend` }], THIS_WORKTREE);
  assert.deepEqual(toKill, [222]);
  assert.deepEqual(toSkip, []);
});

// The regression test for the pkill incident: a process on the port this
// worktree thinks it owns, but actually belongs to a different worktree
// (or an unrelated app), must never be killed just because of the port.
test("a candidate whose cwd is a different worktree is skipped, not killed", () => {
  const { toKill, toSkip } = pidsToTeardown(
    [{ pid: 333, cwd: "/Users/dev/scripta-wt/other-branch" }],
    THIS_WORKTREE,
  );
  assert.deepEqual(toKill, []);
  assert.equal(toSkip.length, 1);
  assert.equal(toSkip[0].pid, 333);
  assert.match(toSkip[0].reason, /outside/i);
});

test("a candidate with no resolvable cwd is skipped", () => {
  const { toKill, toSkip } = pidsToTeardown([{ pid: 444, cwd: undefined }], THIS_WORKTREE);
  assert.deepEqual(toKill, []);
  assert.equal(toSkip.length, 1);
  assert.equal(toSkip[0].pid, 444);
  assert.match(toSkip[0].reason, /could not be resolved/i);
});

test("no candidates returns empty lists with no error", () => {
  const { toKill, toSkip } = pidsToTeardown([], THIS_WORKTREE);
  assert.deepEqual(toKill, []);
  assert.deepEqual(toSkip, []);
});

test("a cwd that merely starts with the same characters but is a sibling directory is skipped", () => {
  // /Users/dev/scripta-wt/x must not be treated as inside /Users/dev/scripta
  // just because the string "/Users/dev/scripta" is a textual prefix.
  const { toKill, toSkip } = pidsToTeardown([{ pid: 555, cwd: "/Users/dev/scripta-wt/x" }], THIS_WORKTREE);
  assert.deepEqual(toKill, []);
  assert.equal(toSkip.length, 1);
});

test("multiple candidates are partitioned independently", () => {
  const { toKill, toSkip } = pidsToTeardown(
    [
      { pid: 1, cwd: THIS_WORKTREE },
      { pid: 2, cwd: "/Users/dev/scripta-wt/other" },
      { pid: 3, cwd: undefined },
      { pid: 4, cwd: `${THIS_WORKTREE}/mobile` },
    ],
    THIS_WORKTREE,
  );
  assert.deepEqual(toKill, [1, 4]);
  assert.deepEqual(toSkip.map((s) => s.pid), [2, 3]);
});
