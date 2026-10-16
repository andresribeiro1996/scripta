#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODES,
  buildPrompt,
  codexFailure,
  codexUsage,
  codexVerdict,
  parseFindings,
  parseReviewArgs,
  renderCodexReport,
} from "./codexReview.mjs";
import { appendRound, nextRound, roundLogPath, runsDir } from "./runLog.mjs";

const CODEX_DIR = join(dirname(fileURLToPath(import.meta.url)), "codex");
const TIMEOUT_MS = 45 * 60 * 1000;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repoPath(root, file) {
  const absolute = resolve(process.cwd(), file);
  if (!existsSync(absolute)) throw new Error(`${file} not found.`);
  return relative(root, absolute);
}

function runCodex(root, prompt, base) {
  const eventsFd = openSync(`${base}.jsonl`, "w");
  const errorsFd = openSync(`${base}.stderr.log`, "w");
  try {
    return spawnSync(
      "codex",
      ["exec", "-s", "read-only", "-C", root, "--json", "--output-schema", join(CODEX_DIR, "findings.schema.json"), "-o", `${base}.json`, "-"],
      { input: prompt, stdio: ["pipe", eventsFd, errorsFd], timeout: TIMEOUT_MS },
    );
  } finally {
    closeSync(eventsFd);
    closeSync(errorsFd);
  }
}

function reviewError(root, run, base, treeChanged, failure) {
  if (treeChanged) return "the working tree changed during a read-only review";
  if (run.error?.code === "ETIMEDOUT") return "codex timed out after 45 minutes";
  if (run.error) return `codex did not start: ${run.error.message}`;
  if (run.status !== 0) return `codex exited ${run.status}; see ${relative(root, `${base}.stderr.log`)}`;
  if (failure) return `codex turn failed: ${failure}`;
  return null;
}

function main() {
  const args = parseReviewArgs(process.argv.slice(2));
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const spec = repoPath(root, args.spec);
  const plan = args.plan && repoPath(root, args.plan);
  if (args.mode === "branch") git(root, ["fetch", "-q", "origin", "main"]);

  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const dir = runsDir(root, branch);
  mkdirSync(dir, { recursive: true });
  const kind = `codex-${args.mode}`;
  const round = nextRound(readdirSync(dir), kind);
  const base = join(dir, `${kind}-r${round}`);

  const brief = readFileSync(join(CODEX_DIR, MODES[args.mode].brief), "utf8");
  const before = git(root, ["status", "--porcelain"]);
  const started = Date.now();
  console.log(`[codex-review] ${args.mode} review r${round} running…`);
  const run = runCodex(root, buildPrompt(brief, { spec, plan }), base);
  const seconds = Math.round((Date.now() - started) / 1000);
  const treeChanged = git(root, ["status", "--porcelain"]) !== before;
  const jsonl = readFileSync(`${base}.jsonl`, "utf8");
  const usage = codexUsage(jsonl);

  let error = reviewError(root, run, base, treeChanged, codexFailure(jsonl));
  let result = null;
  if (!error) {
    try {
      result = parseFindings(readFileSync(`${base}.json`, "utf8"));
    } catch (parseError) {
      error = `output did not match the schema: ${parseError.message}`;
    }
  }

  const report = `${base}.md`;
  writeFileSync(report, renderCodexReport({ mode: args.mode, round, seconds, usage, result, error }));
  const verdict = error ? `CODEX: ERROR — ${error}` : codexVerdict(result);
  const exit = error ? 2 : verdict === "CODEX: PASS" ? 0 : 1;
  appendRound(roundLogPath(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])), {
    at: new Date().toISOString(),
    branch,
    kind,
    round,
    model: usage.model,
    exit,
    seconds,
    tokens: usage.tokens,
  });
  console.log(`[codex-review] ${relative(root, report)}: ${verdict}`);
  process.exitCode = exit;
}

try {
  main();
} catch (error) {
  console.error(`[codex-review] failed: ${error.message}`);
  process.exitCode = 2;
}
