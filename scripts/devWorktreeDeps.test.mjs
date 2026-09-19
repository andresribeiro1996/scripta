import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { linkWorktreeDeps } from "./devWorktreeDeps.mjs";

function withRoots(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-devWorktreeDeps-"));
  const primaryRoot = join(dir, "primary");
  const worktreeRoot = join(dir, "worktree");
  mkdirSync(primaryRoot, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  try {
    return fn({ primaryRoot, worktreeRoot });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedWorkspace(root, { lockfile = "lock-a" } = {}) {
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["frontend", "packages/*"] }));
  writeFileSync(join(root, "package-lock.json"), lockfile);
  for (const dir of ["frontend", "packages/shared"]) {
    mkdirSync(join(root, dir, "node_modules"), { recursive: true });
  }
  mkdirSync(join(root, "node_modules"), { recursive: true });
}

// A worktree has every workspace directory checked out (they hold tracked
// source), just not node_modules — unlike seedWorkspace, which is only ever
// used for the primary checkout side of these tests.
function seedCheckout(root) {
  for (const dir of ["frontend", "packages/shared"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
}

test("symlinks every workspace's node_modules when the lockfiles match", () => {
  withRoots(({ primaryRoot, worktreeRoot }) => {
    seedWorkspace(primaryRoot);
    seedCheckout(worktreeRoot);
    writeFileSync(join(worktreeRoot, "package-lock.json"), "lock-a");

    const result = linkWorktreeDeps({ primaryRoot, worktreeRoot });

    assert.deepEqual(result, { linked: [".", "frontend", "packages/shared"], skipped: [], reason: null });
    for (const dir of [".", "frontend", "packages/shared"]) {
      const target = join(worktreeRoot, dir, "node_modules");
      assert.ok(lstatSync(target).isSymbolicLink());
      assert.equal(readlinkSync(target), join(primaryRoot, dir, "node_modules"));
    }
  });
});

test("falls back to a real install when the lockfiles differ", () => {
  withRoots(({ primaryRoot, worktreeRoot }) => {
    seedWorkspace(primaryRoot, { lockfile: "lock-a" });
    writeFileSync(join(worktreeRoot, "package-lock.json"), "lock-b");

    const result = linkWorktreeDeps({ primaryRoot, worktreeRoot });

    assert.equal(result.reason, "lockfile-mismatch");
    assert.equal(result.linked.length, 0);
    assert.ok(!existsSync(join(worktreeRoot, "frontend", "node_modules")));
  });
});

test("leaves an already-installed workspace alone instead of clobbering it", () => {
  withRoots(({ primaryRoot, worktreeRoot }) => {
    seedWorkspace(primaryRoot);
    seedCheckout(worktreeRoot);
    writeFileSync(join(worktreeRoot, "package-lock.json"), "lock-a");
    mkdirSync(join(worktreeRoot, "frontend", "node_modules"), { recursive: true });
    writeFileSync(join(worktreeRoot, "frontend", "node_modules", "real.txt"), "already installed");

    const result = linkWorktreeDeps({ primaryRoot, worktreeRoot });

    assert.ok(result.linked.includes("."));
    assert.ok(result.skipped.includes("frontend"));
    assert.ok(!lstatSync(join(worktreeRoot, "frontend", "node_modules")).isSymbolicLink());
  });
});

test("replaces a stale (dangling) symlink from an earlier run", () => {
  withRoots(({ primaryRoot, worktreeRoot }) => {
    seedWorkspace(primaryRoot);
    seedCheckout(worktreeRoot);
    writeFileSync(join(worktreeRoot, "package-lock.json"), "lock-a");
    symlinkSync(join(primaryRoot, "frontend", "node_modules-old"), join(worktreeRoot, "frontend", "node_modules"), "dir");

    const result = linkWorktreeDeps({ primaryRoot, worktreeRoot });

    assert.ok(result.linked.includes("frontend"));
    assert.equal(readlinkSync(join(worktreeRoot, "frontend", "node_modules")), join(primaryRoot, "frontend", "node_modules"));
  });
});

test("is a no-op when called from the primary checkout itself", () => {
  withRoots(({ primaryRoot }) => {
    seedWorkspace(primaryRoot);
    const result = linkWorktreeDeps({ primaryRoot, worktreeRoot: primaryRoot });
    assert.deepEqual(result, { linked: [], skipped: [], reason: "same-checkout" });
  });
});

test("reports needing a real install when the primary checkout has no node_modules yet", () => {
  withRoots(({ primaryRoot, worktreeRoot }) => {
    writeFileSync(join(primaryRoot, "package.json"), JSON.stringify({ workspaces: [] }));
    writeFileSync(join(primaryRoot, "package-lock.json"), "lock-a");
    writeFileSync(join(worktreeRoot, "package-lock.json"), "lock-a");

    const result = linkWorktreeDeps({ primaryRoot, worktreeRoot });

    assert.deepEqual(result, { linked: [], skipped: [], reason: "primary-has-no-node_modules" });
  });
});
