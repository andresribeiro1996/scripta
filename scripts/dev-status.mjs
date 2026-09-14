#!/usr/bin/env node
// A snapshot of every worktree's dev stack: slot, branch, agent session,
// ports, per-stack memory and CPU, emulator leases and host headroom.
// See docs/superpowers/specs/2026-09-11-dev-status-design.md. Reports
// only — it never kills a process, never blocks a boot and never writes
// to the registry.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeIdentity } from "./devHost.mjs";
import { collectStatus } from "./devStatus.mjs";
import { renderStatus, renderWorktree } from "./devStatusRender.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

function flagValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const next = args[index + 1];
  return next === undefined || next.startsWith("--") ? true : next;
}

const status = collectStatus({ repoRoot });

if (args.includes("--json")) {
  console.log(JSON.stringify(status, null, 2));
} else {
  const worktreeFlag = flagValue("--worktree");
  if (worktreeFlag === undefined) {
    process.stdout.write(renderStatus(status));
  } else {
    const path = worktreeFlag === true ? worktreeIdentity(process.cwd()).worktree : worktreeIdentity(worktreeFlag).worktree;
    process.stdout.write(renderWorktree(status, path));
  }
}
