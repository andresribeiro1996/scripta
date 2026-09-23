// Symlinks node_modules from the primary checkout into a freshly created
// worktree instead of reinstalling — instant, and safe exactly when the
// worktree's root package-lock.json (npm workspaces hoists the whole
// monorepo under one lockfile) is byte-identical to the primary checkout's,
// meaning nothing on this branch touched dependencies.
//
// The root node_modules is the exception: it holds npm's workspace links
// (`@scripta/shared -> ../../packages/shared`), and a relative link read
// through a symlink into the primary resolves to the primary's source. So it
// becomes a real directory of per-package symlinks into the primary, with the
// workspace packages linked to this worktree's own copies instead.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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

function linkRootNodeModules(primaryRoot, worktreeRoot) {
  const workspaces = new Map();
  for (const dir of resolveWorkspaceDirs(worktreeRoot)) {
    if (dir === ".") continue;
    const { name } = JSON.parse(readFileSync(join(worktreeRoot, dir, "package.json"), "utf8"));
    workspaces.set(name, join(worktreeRoot, dir));
  }
  const source = join(primaryRoot, "node_modules");
  const target = join(worktreeRoot, "node_modules");
  const link = (entry) => {
    const path = join(target, entry);
    const workspace = workspaces.get(entry);
    symlinkSync(workspace ? relative(dirname(path), workspace) : join(source, entry), path, "dir");
  };
  mkdirSync(target);
  for (const entry of readdirSync(source)) {
    if (!entry.startsWith("@")) {
      link(entry);
      continue;
    }
    mkdirSync(join(target, entry));
    for (const scoped of readdirSync(join(source, entry))) link(`${entry}/${scoped}`);
  }
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
    const isRoot = dir === ".";
    if (stat && !(stat.isSymbolicLink() && (isRoot || !existsSync(target)))) {
      // A real directory (an earlier `npm install` or root link farm) or an
      // already-valid symlink (a previous run of this script) — leave it alone.
      skipped.push(dir);
      continue;
    }
    // A stale symlink whose target is gone, or a root symlinked wholesale by
    // an earlier version of this script.
    if (stat) unlinkSync(target);
    if (isRoot) linkRootNodeModules(primaryRoot, worktreeRoot);
    else symlinkSync(join(primaryRoot, dir, "node_modules"), target, "dir");
    linked.push(dir);
  }
  return { linked, skipped, reason: null };
}
