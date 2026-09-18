#!/usr/bin/env node
// Run right after creating a worktree (EnterWorktree, or `git worktree add`)
// so a new agent session gets a working install without paying for a full
// `npm install` across the monorepo. See AGENTS.md's "Working across
// concurrent agents" for when this runs.
//
// Fast path: symlink node_modules from the primary checkout wherever the
// worktree's root package-lock.json matches it byte-for-byte (see
// devWorktreeDeps.mjs). Falls back to a real `npm install` in the worktree
// itself when that's not safe — this branch has touched dependencies, or
// the primary checkout has no node_modules to borrow from yet — so the
// command always ends in a working state either way.

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { linkWorktreeDeps } from "./devWorktreeDeps.mjs";

const worktreeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gitCommonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  cwd: worktreeRoot,
  encoding: "utf8",
}).trim();
const primaryRoot = dirname(gitCommonDir);

const { linked, skipped, reason } = linkWorktreeDeps({ primaryRoot, worktreeRoot });

if (reason === "same-checkout") {
  console.log("[dev-worktree-deps] This is the primary checkout — nothing to link.");
  process.exit(0);
}

if (linked.length) console.log(`[dev-worktree-deps] Linked from the primary checkout: ${linked.join(", ")}`);
if (skipped.length && !reason) console.log(`[dev-worktree-deps] Already present, left alone: ${skipped.join(", ")}`);

if (reason === "lockfile-mismatch") {
  console.log("[dev-worktree-deps] package-lock.json differs from the primary checkout — installing for real instead of linking.");
} else if (reason === "primary-has-no-node_modules") {
  console.log("[dev-worktree-deps] Primary checkout has no node_modules yet — installing for real instead of linking.");
}

if (reason === "lockfile-mismatch" || reason === "primary-has-no-node_modules") {
  execFileSync("npm", ["install"], { cwd: worktreeRoot, stdio: "inherit" });
}
