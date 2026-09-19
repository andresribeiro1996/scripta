// Symlinks node_modules from the primary checkout into a freshly created
// worktree instead of reinstalling — instant, and safe exactly when the
// worktree's root package-lock.json (npm workspaces hoists the whole
// monorepo under one lockfile) is byte-identical to the primary checkout's,
// meaning nothing on this branch touched dependencies.

import { existsSync, lstatSync, readdirSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

function resolveWorkspaceDirs(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dirs = ["."];
  for (const pattern of pkg.workspaces ?? []) {
    if (!pattern.endsWith("/*")) {
      dirs.push(pattern);
      continue;
    }
    const base = pattern.slice(0, -2);
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(base, entry.name));
    }
  }
  return dirs;
}

function nodeModulesDirsIn(root) {
  return resolveWorkspaceDirs(root).filter((dir) => existsSync(join(root, dir, "node_modules")));
}

function lockfilesMatch(primaryRoot, worktreeRoot) {
  const a = join(primaryRoot, "package-lock.json");
  const b = join(worktreeRoot, "package-lock.json");
  if (!existsSync(a) || !existsSync(b)) return false;
  return readFileSync(a, "utf8") === readFileSync(b, "utf8");
}

/**
 * @returns {{ linked: string[], skipped: string[], reason: string | null }}
 * `reason` is null on the fast (symlinked) path, and one of
 * "same-checkout" | "primary-has-no-node_modules" | "lockfile-mismatch"
 * when the caller should fall back to a real `npm install` instead.
 */
export function linkWorktreeDeps({ primaryRoot, worktreeRoot }) {
  if (resolve(primaryRoot) === resolve(worktreeRoot)) {
    return { linked: [], skipped: [], reason: "same-checkout" };
  }
  const dirs = nodeModulesDirsIn(primaryRoot);
  if (dirs.length === 0) {
    return { linked: [], skipped: [], reason: "primary-has-no-node_modules" };
  }
  if (!lockfilesMatch(primaryRoot, worktreeRoot)) {
    return { linked: [], skipped: dirs, reason: "lockfile-mismatch" };
  }
  const linked = [];
  const skipped = [];
  for (const dir of dirs) {
    const target = join(worktreeRoot, dir, "node_modules");
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat && !(stat.isSymbolicLink() && !existsSync(target))) {
      // A real directory (an earlier `npm install`) or an already-valid
      // symlink (a previous run of this script) — leave it alone.
      skipped.push(dir);
      continue;
    }
    if (stat) unlinkSync(target); // a stale symlink whose target is gone
    symlinkSync(join(primaryRoot, dir, "node_modules"), target, "dir");
    linked.push(dir);
  }
  return { linked, skipped, reason: null };
}
