#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  agentsFilesFor,
  gatePassed,
  outOfScope,
  parseGateArgs,
  renderGateReport,
  tail,
  taskFiles,
  verifyCommands,
} from "./gateCore.mjs";
import { appendRound, nextRound, roundLogPath, runsDir } from "./runLog.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function nulSeparated(text) {
  return text.split("\0").filter(Boolean);
}

function runCheck(root, dir, round, index, { cwd, command }) {
  const log = `gate-r${round}-${index + 1}.log`;
  const logPath = join(dir, log);
  const fd = openSync(logPath, "w");
  const started = Date.now();
  const run = spawnSync(command, { cwd: join(root, cwd), shell: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  if (run.error) writeFileSync(logPath, `${run.error.message}\n`, { flag: "a" });
  const ok = run.status === 0 && !run.error;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`[gate] ${ok ? "PASS" : "FAIL"} ${command} (${seconds}s)`);
  return { cwd, command, ok, seconds, log, tail: ok ? "" : tail(readFileSync(logPath, "utf8"), 40) };
}

function main() {
  const { plan, task } = parseGateArgs(process.argv.slice(2));
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const changed = [
    ...new Set([
      ...nulSeparated(git(root, ["diff", "--name-only", "-z", "HEAD"])),
      ...nulSeparated(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
    ]),
  ];
  if (changed.length === 0) {
    console.error("[gate] nothing changed against HEAD.");
    process.exitCode = 1;
    return;
  }

  const sha = git(root, ["rev-parse", "--short", "HEAD"]).trim();
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const scope = plan ? { task, outside: outOfScope(changed, taskFiles(readFileSync(plan, "utf8"), task)) } : null;
  const commands = verifyCommands(agentsFilesFor(changed), (file) => readFileSync(join(root, file), "utf8"));

  const dir = runsDir(root, branch);
  mkdirSync(dir, { recursive: true });
  const round = nextRound(readdirSync(dir), "gate");
  const started = Date.now();
  const results = commands.map((check, index) => runCheck(root, dir, round, index, check));
  const pass = gatePassed({ results, scope });

  const report = join(dir, `gate-r${round}.md`);
  writeFileSync(report, renderGateReport({ round, sha, results, scope }));
  const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  appendRound(roundLogPath(commonDir), {
    at: new Date().toISOString(),
    branch,
    kind: "gate",
    round,
    model: null,
    exit: pass ? 0 : 1,
    seconds: Math.round((Date.now() - started) / 1000),
    tokens: null,
  });
  console.log(`[gate] ${relative(root, report)}: RESULT: ${pass ? "PASS" : "FAIL"}`);
  process.exitCode = pass ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(`[gate] failed: ${error.message}`);
  process.exitCode = 1;
}
