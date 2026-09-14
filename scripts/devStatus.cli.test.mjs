import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cliPath = fileURLToPath(new URL("./dev-status.mjs", import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

test("--worktree on a path outside any git repo exits non-zero with a plain message, no stack trace", () => {
  const result = run(["--worktree", "/tmp"]);
  assert.notEqual(result.status, 0);
  const combined = `${result.stdout}${result.stderr}`;
  assert.doesNotMatch(combined, /at .*\(.*:\d+:\d+\)/);
  assert.doesNotMatch(combined, /Error: Command failed/);
  assert.match(combined, /\/tmp/);
});

test("a plain run with no flags exits 0 and prints the host line", () => {
  const result = run([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /scripta dev ·/);
});
