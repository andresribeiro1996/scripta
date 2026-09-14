import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertResourceGate, claimThisWorktreeSlot } from "./devClaim.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const realExample = readFileSync(join(repoRoot, "backend", ".env.example"), "utf8");

const roomyHost = { freeBytes: 16 * 1024 ** 3, loadAvg1: 1 };

function liveEntry() {
  return { worktree: "/wt/other", branch: "b", pid: process.pid, session: null, claimedAt: "t" };
}

test("assertResourceGate: this worktree's own live slot does not count toward the limit", () => {
  const registry = {
    slots: {
      1: { ...liveEntry(), worktree: "/wt/self" },
      2: liveEntry(),
      3: liveEntry(),
      4: liveEntry(),
    },
    devices: {},
  };
  // 4 live slots total, but one is this worktree's own — re-running its
  // own already-live stack must never be blocked by the 4-stack gate.
  assertResourceGate({ registry, worktree: "/wt/self", isPortFree: () => true, host: roomyHost });
});

test("assertResourceGate: 4 OTHER live slots still throws", () => {
  const registry = {
    slots: { 1: liveEntry(), 2: liveEntry(), 3: liveEntry(), 4: liveEntry() },
    devices: {},
  };
  assert.throws(
    () => assertResourceGate({ registry, worktree: "/wt/self", isPortFree: () => true, host: roomyHost }),
    /4 stacks/,
  );
});

test("assertResourceGate: 3 OTHER live slots does not throw", () => {
  const registry = {
    slots: { 1: liveEntry(), 2: liveEntry(), 3: liveEntry() },
    devices: {},
  };
  assertResourceGate({ registry, worktree: "/wt/self", isPortFree: () => true, host: roomyHost });
});

// Sets up an isolated, throwaway git repo with its own .git (so
// registryPath() never touches the real shared registry) plus a second
// linked worktree off it, so worktreeIdentity() reports isPrimary: false
// and claimSlot walks the normal 1..MAX_SLOT search instead of being
// pinned to slot 0 — keeping this independent of whatever real slots
// this machine's other worktrees currently hold.
async function withClaimableWorktree(fn) {
  const primaryDir = mkdtempSync(join(tmpdir(), "scripta-devClaim-primary-"));
  const childDir = mkdtempSync(join(tmpdir(), "scripta-devClaim-child-"));
  rmSync(childDir, { recursive: true, force: true }); // git worktree add wants to create this itself
  const git = (args, cwd = primaryDir) => execFileSync("git", args, { cwd, encoding: "utf8" });
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "dev-claim-test@example.com"]);
    git(["config", "user.name", "dev-claim-test"]);
    for (const sub of ["backend", "frontend", "mobile"]) mkdirSync(join(primaryDir, sub));
    writeFileSync(join(primaryDir, "backend", ".env.example"), realExample);
    writeFileSync(join(primaryDir, "frontend", ".gitkeep"), "");
    writeFileSync(join(primaryDir, "mobile", ".gitkeep"), "");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "init"]);
    git(["worktree", "add", "-q", "-b", "dev-claim-test-branch", childDir]);
    // Await inside the try: the callback is async, and its file/lock
    // operations must finish BEFORE the finally below deletes the very
    // directories (and the registry's .lock file) it depends on.
    return await fn(childDir);
  } finally {
    rmSync(childDir, { recursive: true, force: true });
    rmSync(primaryDir, { recursive: true, force: true });
  }
}

test("claimThisWorktreeSlot is idempotent: claiming twice from the same worktree returns the same slot", async () => {
  await withClaimableWorktree(async (worktreeRoot) => {
    const first = await claimThisWorktreeSlot({ repoRoot: worktreeRoot });
    const second = await claimThisWorktreeSlot({ repoRoot: worktreeRoot });
    assert.equal(first.slot, second.slot);
    assert.deepEqual(first.ports, second.ports);
  });
});

test("claimThisWorktreeSlot writes the derived env values for the claimed slot", async () => {
  await withClaimableWorktree(async (worktreeRoot) => {
    const { ports } = await claimThisWorktreeSlot({ repoRoot: worktreeRoot });
    const backendEnv = readFileSync(join(worktreeRoot, "backend", ".env"), "utf8");
    assert.match(backendEnv, new RegExp(`^PORT=${ports.backend}$`, "m"));
    const frontendEnv = readFileSync(join(worktreeRoot, "frontend", ".env.local"), "utf8");
    assert.match(frontendEnv, new RegExp(`^VITE_PORT=${ports.vite}$`, "m"));
  });
});
