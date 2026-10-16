import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function runsDir(worktreeRoot, branch) {
  return join(worktreeRoot, ".superpowers", "runs", branch.replaceAll("/", "-"));
}

export function roundLogPath(gitCommonDir) {
  return join(dirname(gitCommonDir), ".superpowers", "rounds.jsonl");
}

export function nextRound(names, kind) {
  const pattern = new RegExp(`^${kind}-r(\\d+)\\.md$`);
  const rounds = names.map((name) => name.match(pattern)?.[1]).filter(Boolean).map(Number);
  return Math.max(0, ...rounds) + 1;
}

export function appendRound(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}
