import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendRound, nextRound, roundLogPath, runsDir } from "./runLog.mjs";

test("runsDir gives each branch its own folder, slashes flattened", () => {
  assert.equal(runsDir("/w", "claude/a-b"), "/w/.superpowers/runs/claude-a-b");
  assert.notEqual(runsDir("/w", "claude/a"), runsDir("/w", "claude/b"));
});

test("roundLogPath lands in the main checkout, outside every worktree", () => {
  assert.equal(roundLogPath("/repo/.git"), "/repo/.superpowers/rounds.jsonl");
});

test("nextRound counts only that kind's reports", () => {
  assert.equal(nextRound([], "gate"), 1);
  assert.equal(nextRound(["gate-r1.md", "gate-r1-1.log", "gate-r3.md", "codex-plan-r5.md"], "gate"), 4);
  assert.equal(nextRound(["gate-r2.md", "codex-plan-r1.jsonl"], "codex-plan"), 1);
  assert.equal(nextRound(["codex-plan-r1.md", "codex-branch-r4.md"], "codex-plan"), 2);
});

test("appendRound creates the folder and appends one JSON line per run", () => {
  const path = join(mkdtempSync(join(tmpdir(), "rounds-")), ".superpowers", "rounds.jsonl");
  appendRound(path, { kind: "gate", round: 1 });
  appendRound(path, { kind: "gate", round: 2 });
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), { kind: "gate", round: 2 });
});
