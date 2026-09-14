#!/usr/bin/env node
// A snapshot of every worktree's dev stack: slot, branch, agent session,
// ports, per-stack memory and CPU, emulator leases and host headroom.
// See docs/superpowers/specs/2026-09-11-dev-status-design.md. Reports
// only — it never kills a process, never blocks a boot and never writes
// to the registry.
//
// --json is for agents and scripts, but `npm run dev:status -- --json`
// prefixes npm's own "> dev:status" banner to stdout ahead of the JSON,
// breaking a downstream parser — invoke `node scripts/dev-status.mjs
// --json` directly, or `npm run --silent dev:status -- --json`, instead.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeIdentity } from "./devHost.mjs";
import { collectStatus } from "./devStatus.mjs";
import { renderStatus, renderWorktree } from "./devStatusRender.mjs";
import { startServer } from "./dev-status-server.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

function flagValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const next = args[index + 1];
  return next === undefined || next.startsWith("--") ? true : next;
}

function main() {
  if (args.includes("--serve")) {
    startServer({ repoRoot });
    return;
  }

  const status = collectStatus({ repoRoot });

  if (args.includes("--json")) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  const worktreeFlag = flagValue("--worktree");
  if (worktreeFlag === undefined) {
    process.stdout.write(renderStatus(status));
    return;
  }

  const target = worktreeFlag === true ? process.cwd() : worktreeFlag;
  // worktreeIdentity shells out to `git rev-parse --show-toplevel`, which
  // throws when the path isn't inside any git repo — a typo'd
  // --worktree argument, most commonly. Caught here and reworded rather
  // than left to the outer catch below, so the message names the actual
  // path instead of git's own stderr text.
  let identity;
  try {
    identity = worktreeIdentity(target);
  } catch {
    console.error(` ${target} is not a git worktree.`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(renderWorktree(status, identity.worktree));
}

try {
  main();
} catch (error) {
  console.error(` dev:status failed: ${error.message}`);
  process.exitCode = 1;
}
