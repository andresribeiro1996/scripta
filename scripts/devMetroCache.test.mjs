import assert from "node:assert/strict";
import { test } from "node:test";
import { metroCacheDir, metroCacheEnv } from "./devMetroCache.mjs";

const PRIMARY = "/Users/someone/Documents/scripta";
const WORKTREE = "/Users/someone/Documents/scripta/.claude/worktrees/feature";

test("two worktrees never share a cache directory", () => {
  assert.notEqual(metroCacheDir(PRIMARY, { root: "/tmp" }), metroCacheDir(WORKTREE, { root: "/tmp" }));
});

test("the same worktree keeps the same cache across runs", () => {
  assert.equal(metroCacheDir(WORKTREE, { root: "/tmp" }), metroCacheDir(WORKTREE, { root: "/tmp" }));
});

test("the directory is outside the worktree, so Metro never watches its own cache", () => {
  const dir = metroCacheDir(WORKTREE, { root: "/tmp" });
  assert.equal(dir.startsWith("/tmp/"), true);
  assert.equal(dir.includes(WORKTREE), false);
});

test("metroCacheEnv creates the directory and points TMPDIR at it", () => {
  const made = [];
  const env = metroCacheEnv(WORKTREE, { root: "/tmp", mkdir: (dir, options) => made.push([dir, options]) });
  assert.deepEqual(Object.keys(env), ["TMPDIR"]);
  assert.equal(env.TMPDIR, metroCacheDir(WORKTREE, { root: "/tmp" }));
  assert.deepEqual(made, [[env.TMPDIR, { recursive: true }]]);
});
