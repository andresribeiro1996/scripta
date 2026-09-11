# Worktree Port Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every git worktree its own non-colliding set of dev ports, derived from one claimed slot number, so no worktree can silently read another branch's database.

**Architecture:** A registry file in the shared `.git` directory records which worktree holds which slot, which agent session owns it, and which of two emulators is leased. Three ports derive arithmetically from the slot; five config values derive from those ports and are written into `backend/.env`, `frontend/.env.local` and `mobile/.env.local` at boot. Everything that currently hardcodes 3000/8081/5173 reads the claim instead.

**Tech Stack:** Node 22 ESM (`.mjs`), `node:test` + `node:assert/strict`, no new dependencies. Vite 8, Fastify 5, Expo SDK 57.

**Spec:** `docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md`

## Global Constraints

- No new npm dependencies. Reuse `node:` builtins and existing helpers (`scripts/lanAddress.mjs`, `scripts/devEnvFile.mjs`, `scripts/devDataDir.mjs`).
- No comments in code unless the surrounding file already comments heavily — `scripts/*.mjs` in this repo do carry explanatory header comments; match the local file.
- Slots are `0..15`. `backend = 3000 + 100 * slot`, `vite = 5173 + 100 * slot`, `metro = 8081 + 100 * slot`.
- Slot 0 is reserved for the primary checkout (first entry of `git worktree list`).
- Registry path: `$(git rev-parse --path-format=absolute --git-common-dir)/scripta-dev.json`. The `--path-format=absolute` flag is required; the bare form returns a relative `.git` in the primary checkout. Requires git ≥ 2.31 (machine has 2.55.0).
- Boot thresholds: refuse past 4 booted stacks, refuse under 4 GB free memory, refuse a second emulator over 1-minute load average 8.
- Every `ps` invocation sets `LC_ALL=C` — the default locale prints `0,0` for CPU, which `parseFloat` silently reads as 0.
- Tests live beside the code as `scripts/<name>.test.mjs`, matching `scripts/devEnvFile.test.mjs`.

---

### Task 1: Wire script tests into `npm test`, and derive ports from a slot

`scripts/devEnvFile.test.mjs` already exists but nothing runs it — root `npm test` is `npm test --workspaces --if-present`, and `scripts/` is not a workspace. Every test this plan adds would be orphaned the same way, so this is fixed first.

**Files:**
- Modify: `package.json:11-17` (the `scripts` block)
- Create: `scripts/devRegistry.mjs`
- Test: `scripts/devRegistry.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `portsForSlot(slot) -> { backend: number, vite: number, metro: number }`, and the constants `MAX_SLOT = 15`, `BACKEND_BASE = 3000`, `VITE_BASE = 5173`, `METRO_BASE = 8081`.

- [ ] **Step 1: Add a script test runner to the root package.json**

In `package.json`, replace the `"test"` line and add `"test:scripts"` above it:

```json
    "test:scripts": "node --test scripts/*.test.mjs",
    "test": "npm run test:scripts && npm test --workspaces --if-present",
```

- [ ] **Step 2: Verify the orphaned test now runs**

Run: `npm run test:scripts`
Expected: PASS, 3 tests from `scripts/devEnvFile.test.mjs`. If this fails, stop — the runner is wrong, not the tests.

- [ ] **Step 3: Write the failing test**

Create `scripts/devRegistry.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SLOT, portsForSlot } from "./devRegistry.mjs";

test("slot 0 keeps the familiar default ports", () => {
  assert.deepEqual(portsForSlot(0), { backend: 3000, vite: 5173, metro: 8081 });
});

test("each slot shifts every port by 100", () => {
  assert.deepEqual(portsForSlot(2), { backend: 3200, vite: 5373, metro: 8281 });
});

test("the last slot stays inside its range", () => {
  assert.deepEqual(portsForSlot(MAX_SLOT), { backend: 4500, vite: 6673, metro: 9581 });
});

test("a slot outside 0..MAX_SLOT is rejected", () => {
  assert.throws(() => portsForSlot(-1), /slot/);
  assert.throws(() => portsForSlot(MAX_SLOT + 1), /slot/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test scripts/devRegistry.test.mjs`
Expected: FAIL — `Cannot find module './devRegistry.mjs'`

- [ ] **Step 5: Write minimal implementation**

Create `scripts/devRegistry.mjs`:

```js
// One slot per worktree. Every dev port this repo binds derives from it,
// so two worktrees can never land on the same number — see
// docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md.

export const MAX_SLOT = 15;
export const BACKEND_BASE = 3000;
export const VITE_BASE = 5173;
export const METRO_BASE = 8081;

export function portsForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
    throw new Error(`slot must be an integer in 0..${MAX_SLOT}, got ${slot}`);
  }
  return {
    backend: BACKEND_BASE + 100 * slot,
    vite: VITE_BASE + 100 * slot,
    metro: METRO_BASE + 100 * slot,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS, 7 tests total.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/devRegistry.mjs scripts/devRegistry.test.mjs
git commit -m "feat(dev): derive worktree ports from a slot, and run script tests"
```

---

### Task 2: Registry file read, write and locking

**Files:**
- Modify: `scripts/devRegistry.mjs`
- Test: `scripts/devRegistry.test.mjs`

**Interfaces:**
- Consumes: `portsForSlot` from Task 1.
- Produces:
  - `registryPath(cwd) -> string`
  - `readRegistry(path) -> { version, slots, devices }`
  - `writeRegistry(path, registry) -> void`
  - `withLock(path, fn) -> ReturnType<fn>`
  - `EMPTY_REGISTRY` — the shape returned when no file exists.

- [ ] **Step 1: Write the failing test**

Append to `scripts/devRegistry.test.mjs`:

```js
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry, withLock, writeRegistry } from "./devRegistry.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-devRegistry-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readRegistry returns an empty registry when the file is absent", () => {
  withTempDir((dir) => {
    const registry = readRegistry(join(dir, "scripta-dev.json"));
    assert.equal(registry.version, 1);
    assert.deepEqual(registry.slots, {});
    assert.deepEqual(registry.devices, { "scripta-dev-0": null, "scripta-dev-1": null });
  });
});

test("readRegistry returns an empty registry when the file is corrupt", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    writeFileSync(path, "{ not json");
    assert.deepEqual(readRegistry(path).slots, {});
  });
});

test("writeRegistry round-trips through readRegistry", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const registry = readRegistry(path);
    registry.slots["2"] = { worktree: "/tmp/wt", branch: "x", pid: 1, session: null, claimedAt: "t" };
    writeRegistry(path, registry);
    assert.equal(readRegistry(path).slots["2"].branch, "x");
    assert.match(readFileSync(path, "utf8"), /\n$/);
  });
});

test("withLock releases the lock so a second call succeeds", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(withLock(path, () => "first"), "first");
    assert.equal(withLock(path, () => "second"), "second");
  });
});

test("withLock releases the lock even when the callback throws", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.throws(() => withLock(path, () => { throw new Error("boom"); }), /boom/);
    assert.equal(withLock(path, () => "after"), "after");
  });
});

test("withLock breaks a lock older than the stale timeout", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    writeFileSync(`${path}.lock`, "99999");
    const old = Date.now() / 1000 - 30;
    utimesSync(`${path}.lock`, old, old);
    assert.equal(withLock(path, () => "broke through"), "broke through");
  });
});
```

Add `utimesSync` to the `node:fs` import at the top of that block.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/devRegistry.test.mjs`
Expected: FAIL — `readRegistry is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/devRegistry.mjs`:

```js
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_STALE_MS = 10_000;

export const EMPTY_REGISTRY = {
  version: 1,
  slots: {},
  devices: { "scripta-dev-0": null, "scripta-dev-1": null },
};

// Inside .git, so it is shared by every worktree of this clone, never
// version-controlled, and disappears with the clone. --path-format=absolute
// matters: the bare form returns a relative ".git" in the primary checkout.
export function registryPath(cwd = process.cwd()) {
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  }).trim();
  return join(gitDir, "scripta-dev.json");
}

export function readRegistry(path) {
  if (!existsSync(path)) return structuredClone(EMPTY_REGISTRY);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: parsed.version ?? 1,
      slots: parsed.slots ?? {},
      devices: { ...EMPTY_REGISTRY.devices, ...(parsed.devices ?? {}) },
    };
  } catch {
    return structuredClone(EMPTY_REGISTRY);
  }
}

export function writeRegistry(path, registry) {
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
}

export function withLock(path, fn) {
  const lockPath = `${path}.lock`;
  let fd;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age > LOCK_STALE_MS) rmSync(lockPath, { force: true });
      else execFileSync("sleep", ["0.1"]);
    }
  }
  if (fd === undefined) throw new Error(`could not acquire ${lockPath}`);
  try {
    writeFileSync(lockPath, String(process.pid));
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS, 13 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/devRegistry.mjs scripts/devRegistry.test.mjs
git commit -m "feat(dev): read, write and lock the worktree slot registry"
```

---

### Task 3: Claim and release a slot

**Files:**
- Modify: `scripts/devRegistry.mjs`
- Test: `scripts/devRegistry.test.mjs`

**Interfaces:**
- Consumes: `portsForSlot`, `readRegistry`, `writeRegistry`, `withLock`.
- Produces:
  - `isPidAlive(pid) -> boolean`
  - `claimSlot({ path, worktree, branch, pid, session, isPrimary, isPortFree }) -> { slot, ports }`
  - `releaseSlot({ path, worktree }) -> void`
  - `slotForWorktree(registry, worktree) -> string | undefined`

`isPortFree` is injected so tests need no sockets. Its production default lives in Task 4.

- [ ] **Step 1: Write the failing test**

Append to `scripts/devRegistry.test.mjs`:

```js
import { claimSlot, releaseSlot, slotForWorktree } from "./devRegistry.mjs";

const allFree = () => true;

function claim(path, worktree, extra = {}) {
  return claimSlot({
    path,
    worktree,
    branch: "b",
    pid: process.pid,
    session: null,
    isPrimary: false,
    isPortFree: allFree,
    ...extra,
  });
}

test("the primary checkout always takes slot 0", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    const primary = claim(path, "/repo", { isPrimary: true });
    assert.equal(primary.slot, 0);
    assert.deepEqual(primary.ports, { backend: 3000, vite: 5173, metro: 8081 });
  });
});

test("a non-primary worktree never takes slot 0", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(claim(path, "/wt/a").slot, 1);
  });
});

test("claiming twice from the same worktree reuses its slot", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(claim(path, "/wt/a").slot, claim(path, "/wt/a").slot);
  });
});

test("slots are handed out lowest-free-first, reusing released gaps", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    claim(path, "/wt/b");
    claim(path, "/wt/c");
    releaseSlot({ path, worktree: "/wt/b" });
    assert.equal(claim(path, "/wt/d").slot, 2);
  });
});

test("a slot whose pid is dead is reclaimable", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a", { pid: 2147483646 });
    assert.equal(claim(path, "/wt/b").slot, 1);
  });
});

test("a slot whose pid is alive is not reclaimable", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    assert.equal(claim(path, "/wt/b").slot, 2);
  });
});

test("a slot whose ports are externally occupied is skipped with a warning", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const busyOnSlotOne = (port) => port !== 3100;
    const result = claim(path, "/wt/a", { isPortFree: busyOnSlotOne });
    assert.equal(result.slot, 2);
  });
});

test("releaseSlot removes only that worktree's entry", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    claim(path, "/wt/a");
    claim(path, "/wt/b");
    releaseSlot({ path, worktree: "/wt/a" });
    const registry = readRegistry(path);
    assert.equal(slotForWorktree(registry, "/wt/a"), undefined);
    assert.equal(slotForWorktree(registry, "/wt/b"), "2");
  });
});

test("running out of slots throws", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    for (let i = 1; i <= MAX_SLOT; i += 1) claim(path, `/wt/${i}`);
    assert.throws(() => claim(path, "/wt/overflow"), /no free slot/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/devRegistry.test.mjs`
Expected: FAIL — `claimSlot is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/devRegistry.mjs`:

```js
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function slotForWorktree(registry, worktree) {
  return Object.keys(registry.slots).find((slot) => registry.slots[slot].worktree === worktree);
}

export function claimSlot({ path, worktree, branch, pid, session, isPrimary, isPortFree }) {
  return withLock(path, () => {
    const registry = readRegistry(path);

    const existing = slotForWorktree(registry, worktree);
    if (existing !== undefined) {
      registry.slots[existing] = { worktree, branch, pid, session, claimedAt: new Date().toISOString() };
      writeRegistry(path, registry);
      return { slot: Number(existing), ports: portsForSlot(Number(existing)) };
    }

    const held = (slot) => {
      const entry = registry.slots[String(slot)];
      return entry !== undefined && isPidAlive(entry.pid);
    };

    const candidates = isPrimary ? [0] : Array.from({ length: MAX_SLOT }, (_, i) => i + 1);
    for (const slot of candidates) {
      if (held(slot)) continue;
      const ports = portsForSlot(slot);
      if (!Object.values(ports).every((port) => isPortFree(port))) continue;
      registry.slots[String(slot)] = { worktree, branch, pid, session, claimedAt: new Date().toISOString() };
      writeRegistry(path, registry);
      return { slot, ports };
    }
    throw new Error(`no free slot in 0..${MAX_SLOT} — run \`npm run dev:status\` to see what holds them`);
  });
}

export function releaseSlot({ path, worktree }) {
  withLock(path, () => {
    const registry = readRegistry(path);
    const slot = slotForWorktree(registry, worktree);
    if (slot === undefined) return;
    delete registry.slots[slot];
    for (const [avd, lease] of Object.entries(registry.devices)) {
      if (lease?.worktree === worktree) registry.devices[avd] = null;
    }
    writeRegistry(path, registry);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS, 22 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/devRegistry.mjs scripts/devRegistry.test.mjs
git commit -m "feat(dev): claim and release worktree slots"
```

---

### Task 4: Port probing, worktree identity, and resource gates

**Files:**
- Create: `scripts/devHost.mjs`
- Test: `scripts/devHost.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `isPortFree(port) -> Promise<boolean>` — async; callers await before passing a sync predicate to `claimSlot`.
  - `probePorts(ports) -> Promise<Record<number, boolean>>`
  - `worktreeIdentity(cwd) -> { worktree, branch, isPrimary }`
  - `assertResourcesAvailable({ stackCount, limits, host }) -> void`
  - `DEFAULT_LIMITS = { maxStacks: 4, minFreeBytes: 4 * 1024 ** 3, maxLoadForSecondEmulator: 8 }`

- [ ] **Step 1: Write the failing test**

Create `scripts/devHost.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS, assertResourcesAvailable, worktreeIdentity } from "./devHost.mjs";

const roomy = { freeBytes: 16 * 1024 ** 3, loadAvg1: 1 };

test("a roomy host passes", () => {
  assertResourcesAvailable({ stackCount: 1, limits: DEFAULT_LIMITS, host: roomy });
});

test("too many stacks is refused, naming the limit", () => {
  assert.throws(
    () => assertResourcesAvailable({ stackCount: 4, limits: DEFAULT_LIMITS, host: roomy }),
    /4 stacks/,
  );
});

test("low free memory is refused", () => {
  assert.throws(
    () => assertResourcesAvailable({
      stackCount: 0,
      limits: DEFAULT_LIMITS,
      host: { freeBytes: 2 * 1024 ** 3, loadAvg1: 1 },
    }),
    /memory/i,
  );
});

test("a second emulator is refused under high load", () => {
  assert.throws(
    () => assertResourcesAvailable({
      stackCount: 0,
      limits: DEFAULT_LIMITS,
      host: { freeBytes: 16 * 1024 ** 3, loadAvg1: 9 },
      wantsSecondEmulator: true,
    }),
    /load/i,
  );
});

test("high load alone does not block a stack", () => {
  assertResourcesAvailable({
    stackCount: 0,
    limits: DEFAULT_LIMITS,
    host: { freeBytes: 16 * 1024 ** 3, loadAvg1: 9 },
  });
});

test("worktreeIdentity reports this repo's branch and primary-ness", () => {
  const identity = worktreeIdentity(process.cwd());
  assert.equal(typeof identity.worktree, "string");
  assert.equal(typeof identity.isPrimary, "boolean");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/devHost.test.mjs`
Expected: FAIL — `Cannot find module './devHost.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/devHost.mjs`:

```js
// Host-side facts the slot registry needs but cannot know: whether a port
// is actually free, which worktree this is, and whether the machine has
// room for another stack.

import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { freemem, loadavg } from "node:os";

export const DEFAULT_LIMITS = {
  maxStacks: 4,
  minFreeBytes: 4 * 1024 ** 3,
  maxLoadForSecondEmulator: 8,
};

export function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

export async function probePorts(ports) {
  const entries = await Promise.all(ports.map(async (port) => [port, await isPortFree(port)]));
  return Object.fromEntries(entries);
}

export function worktreeIdentity(cwd = process.cwd()) {
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const worktree = git(["rev-parse", "--show-toplevel"]);
  const branch = git(["branch", "--show-current"]) || "(detached)";
  const primary = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  return { worktree, branch, isPrimary: worktree === primary };
}

export function readHost() {
  return { freeBytes: freemem(), loadAvg1: loadavg()[0] };
}

export function assertResourcesAvailable({ stackCount, limits, host, wantsSecondEmulator = false }) {
  if (stackCount >= limits.maxStacks) {
    throw new Error(
      `${stackCount} stacks are already running (limit ${limits.maxStacks}) — ` +
        "tear one down, or run `npm run dev:status` to see which.",
    );
  }
  if (host.freeBytes < limits.minFreeBytes) {
    const freeGB = (host.freeBytes / 1024 ** 3).toFixed(1);
    const minGB = (limits.minFreeBytes / 1024 ** 3).toFixed(0);
    throw new Error(`only ${freeGB} GB of memory free (need ${minGB} GB) — close something before booting another stack.`);
  }
  if (wantsSecondEmulator && host.loadAvg1 > limits.maxLoadForSecondEmulator) {
    throw new Error(
      `1-minute load average is ${host.loadAvg1.toFixed(1)} (limit ${limits.maxLoadForSecondEmulator}) — ` +
        "a second emulator would contend for CPU. Wait, or use the one already running.",
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS, 28 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/devHost.mjs scripts/devHost.test.mjs
git commit -m "feat(dev): probe ports, identify the worktree, and gate on host resources"
```

---

### Task 5: The two-slot device lease

**Files:**
- Modify: `scripts/devRegistry.mjs`
- Test: `scripts/devRegistry.test.mjs`

**Interfaces:**
- Consumes: `readRegistry`, `writeRegistry`, `withLock`, `isPidAlive`.
- Produces:
  - `AVDS = ["scripta-dev-0", "scripta-dev-1"]`
  - `takeDevice({ path, worktree, pid, avd }) -> { avd }`
  - `releaseDevice({ path, worktree, avd }) -> void`
  - `deviceHolders(registry) -> Array<{ avd, worktree, pid, takenAt }>`

- [ ] **Step 1: Write the failing test**

Append to `scripts/devRegistry.test.mjs`:

```js
import { AVDS, deviceHolders, releaseDevice, takeDevice } from "./devRegistry.mjs";

test("taking a device returns the first free AVD", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(takeDevice({ path, worktree: "/wt/a", pid: process.pid }).avd, AVDS[0]);
    assert.equal(takeDevice({ path, worktree: "/wt/b", pid: process.pid }).avd, AVDS[1]);
  });
});

test("taking a device twice from the same worktree is idempotent", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    const first = takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    assert.equal(takeDevice({ path, worktree: "/wt/a", pid: process.pid }).avd, first.avd);
  });
});

test("taking a device when both are held names the holders", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    takeDevice({ path, worktree: "/wt/b", pid: process.pid });
    assert.throws(
      () => takeDevice({ path, worktree: "/wt/c", pid: process.pid }),
      /\/wt\/a[\s\S]*\/wt\/b/,
    );
  });
});

test("a lease whose pid is dead is reclaimable", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    takeDevice({ path, worktree: "/wt/a", pid: 2147483646 });
    takeDevice({ path, worktree: "/wt/b", pid: 2147483646 });
    assert.equal(takeDevice({ path, worktree: "/wt/c", pid: process.pid }).avd, AVDS[0]);
  });
});

test("a specific AVD can be requested", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    assert.equal(takeDevice({ path, worktree: "/wt/a", pid: process.pid, avd: AVDS[1] }).avd, AVDS[1]);
  });
});

test("releaseDevice frees only that worktree's lease", () => {
  withTempDir((dir) => {
    const path = join(dir, "scripta-dev.json");
    takeDevice({ path, worktree: "/wt/a", pid: process.pid });
    takeDevice({ path, worktree: "/wt/b", pid: process.pid });
    releaseDevice({ path, worktree: "/wt/a" });
    const holders = deviceHolders(readRegistry(path));
    assert.deepEqual(holders.map((holder) => holder.worktree), ["/wt/b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/devRegistry.test.mjs`
Expected: FAIL — `takeDevice is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/devRegistry.mjs`:

```js
export const AVDS = ["scripta-dev-0", "scripta-dev-1"];

export function deviceHolders(registry) {
  return AVDS.flatMap((avd) => {
    const lease = registry.devices[avd];
    return lease ? [{ avd, ...lease }] : [];
  });
}

export function takeDevice({ path, worktree, pid, avd }) {
  return withLock(path, () => {
    const registry = readRegistry(path);
    const free = (name) => {
      const lease = registry.devices[name];
      return lease === null || lease === undefined || !isPidAlive(lease.pid);
    };
    const mine = AVDS.find((name) => registry.devices[name]?.worktree === worktree);
    if (mine !== undefined) return { avd: mine };

    const wanted = avd ? [avd] : AVDS;
    const chosen = wanted.find(free);
    if (chosen === undefined) {
      const held = deviceHolders(registry)
        .map((holder) => `  ${holder.avd} — ${holder.worktree} since ${holder.takenAt}`)
        .join("\n");
      throw new Error(`every emulator is leased:\n${held}\nWait for one, or release it from that worktree.`);
    }
    registry.devices[chosen] = { worktree, pid, takenAt: new Date().toISOString() };
    writeRegistry(path, registry);
    return { avd: chosen };
  });
}

export function releaseDevice({ path, worktree, avd }) {
  withLock(path, () => {
    const registry = readRegistry(path);
    for (const name of AVDS) {
      const lease = registry.devices[name];
      if (!lease) continue;
      if (lease.worktree === worktree && (avd === undefined || avd === name)) registry.devices[name] = null;
    }
    writeRegistry(path, registry);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS, 34 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/devRegistry.mjs scripts/devRegistry.test.mjs
git commit -m "feat(dev): lease emulators through the registry instead of racing adb"
```

---

### Task 6: Write the five derived values

**Files:**
- Create: `scripts/devSlotEnv.mjs`
- Test: `scripts/devSlotEnv.test.mjs`

**Interfaces:**
- Consumes: `upsertEnvLine` from `scripts/devEnvFile.mjs`; `portsForSlot` from Task 1.
- Produces: `applySlotEnv({ repoRoot, ports, transport, lanAddress }) -> { backendEnv, frontendEnv, mobileEnv }` where `transport` is `"loopback"` or `"lan"`. Returns the paths it wrote, for logging.

- [ ] **Step 1: Write the failing test**

Create `scripts/devSlotEnv.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applySlotEnv } from "./devSlotEnv.mjs";

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-slotEnv-"));
  for (const sub of ["backend", "frontend", "mobile"]) mkdirSync(join(dir, sub));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const slotTwo = { backend: 3200, vite: 5373, metro: 8281 };

test("all five values land in their own files", () => {
  withRepo((repoRoot) => {
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });
    const backend = readFileSync(join(repoRoot, "backend", ".env"), "utf8");
    assert.match(backend, /^PORT=3200$/m);
    assert.match(backend, /^FRONTEND_URL=http:\/\/localhost:5373$/m);
    assert.match(readFileSync(join(repoRoot, "frontend", ".env.local"), "utf8"), /^VITE_API_PORT=3200$/m);
    assert.match(readFileSync(join(repoRoot, "mobile", ".env.local"), "utf8"), /^EXPO_PUBLIC_API_URL=http:\/\/127\.0\.0\.1:3200$/m);
  });
});

test("lan transport substitutes the host address in the mobile URL only", () => {
  withRepo((repoRoot) => {
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "lan", lanAddress: "192.168.1.24" });
    assert.match(readFileSync(join(repoRoot, "mobile", ".env.local"), "utf8"), /^EXPO_PUBLIC_API_URL=http:\/\/192\.168\.1\.24:3200$/m);
    assert.match(readFileSync(join(repoRoot, "backend", ".env"), "utf8"), /^FRONTEND_URL=http:\/\/localhost:5373$/m);
  });
});

test("lan transport without an address is refused", () => {
  withRepo((repoRoot) => {
    assert.throws(() => applySlotEnv({ repoRoot, ports: slotTwo, transport: "lan" }), /lan address/i);
  });
});

test("existing unrelated keys survive", () => {
  withRepo((repoRoot) => {
    applySlotEnv({ repoRoot, ports: slotTwo, transport: "loopback" });
    applySlotEnv({ repoRoot, ports: { backend: 3300, vite: 5473, metro: 8381 }, transport: "loopback" });
    const backend = readFileSync(join(repoRoot, "backend", ".env"), "utf8");
    assert.match(backend, /^PORT=3300$/m);
    assert.doesNotMatch(backend, /^PORT=3200$/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/devSlotEnv.test.mjs`
Expected: FAIL — `Cannot find module './devSlotEnv.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/devSlotEnv.mjs`:

```js
// The five values one slot number decides. Any of them left at a default
// reproduces the bug this whole scheme exists to kill: a frontend that
// renders fine while reading another branch's database.

import { join } from "node:path";
import { upsertEnvLine } from "./devEnvFile.mjs";

export function applySlotEnv({ repoRoot, ports, transport = "loopback", lanAddress }) {
  if (transport === "lan" && !lanAddress) {
    throw new Error("transport 'lan' needs a lan address — pickLanAddress() returned nothing");
  }
  const apiHost = transport === "lan" ? lanAddress : "127.0.0.1";

  const backendEnv = join(repoRoot, "backend", ".env");
  const frontendEnv = join(repoRoot, "frontend", ".env.local");
  const mobileEnv = join(repoRoot, "mobile", ".env.local");

  upsertEnvLine(backendEnv, "PORT", String(ports.backend));
  upsertEnvLine(backendEnv, "FRONTEND_URL", `http://localhost:${ports.vite}`);
  upsertEnvLine(frontendEnv, "VITE_API_PORT", String(ports.backend));
  upsertEnvLine(mobileEnv, "EXPO_PUBLIC_API_URL", `http://${apiHost}:${ports.backend}`);

  return { backendEnv, frontendEnv, mobileEnv };
}
```

The fifth value, Metro's `--port`, is an argument rather than a file and is passed in Task 8.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS, 38 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/devSlotEnv.mjs scripts/devSlotEnv.test.mjs
git commit -m "feat(dev): write the five slot-derived config values"
```

---

### Task 7: Make the frontend follow its slot, and fail loudly

**Files:**
- Modify: `frontend/src/api/baseUrl.ts:19-23`
- Modify: `frontend/vite.config.ts:24`
- Modify: `frontend/.env.example`
- Test: `frontend/scripts/test-baseUrl.mts` (new, matching the existing `test-*.mts` glob in `frontend/package.json`)

**Interfaces:**
- Consumes: `VITE_API_PORT`, written by Task 6.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/test-baseUrl.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveApiUrl } from "../src/api/baseUrl.ts";

test("an explicit VITE_API_URL always wins", () => {
  const url = resolveApiUrl({ apiUrl: "https://api.example.com", apiPort: "3200" }, { protocol: "http:", hostname: "localhost" });
  assert.equal(url, "https://api.example.com");
});

test("the slot's port is used with the page's own host", () => {
  const url = resolveApiUrl({ apiPort: "3200" }, { protocol: "http:", hostname: "localhost" });
  assert.equal(url, "http://localhost:3200");
});

test("a phone on the LAN reaches the same slot on the host it loaded from", () => {
  const url = resolveApiUrl({ apiPort: "3200" }, { protocol: "http:", hostname: "192.168.1.24" });
  assert.equal(url, "http://192.168.1.24:3200");
});

test("with no VITE_API_PORT it falls back to 3000", () => {
  const url = resolveApiUrl({}, { protocol: "http:", hostname: "localhost" });
  assert.equal(url, "http://localhost:3000");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace frontend`
Expected: FAIL — `resolveApiUrl` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/api/baseUrl.ts`, replace lines 19-23 (keeping the existing header comment above them) with:

```ts
/** Exported for tests: the derivation, with its two inputs injected. */
export function resolveApiUrl(
  env: { apiUrl?: string; apiPort?: string },
  location: { protocol: string; hostname: string },
): string {
  if (env.apiUrl) return env.apiUrl;
  const port = Number(env.apiPort) || 3000;
  return `${location.protocol}//${location.hostname}:${port}`;
}

export const API_URL = resolveApiUrl(
  { apiUrl: import.meta.env.VITE_API_URL, apiPort: import.meta.env.VITE_API_PORT },
  window.location,
);
```

In `frontend/vite.config.ts`, change line 24 from `server: { https },` to:

```ts
    server: { https, strictPort: true },
```

Sliding to the next free port is the mechanism that produced the silent cross-branch read; a worktree whose assigned port is taken must refuse to start.

In `frontend/.env.example`, replace the `VITE_API_URL` line with:

```
# Set by the dev boot script from this worktree's slot. The API host is
# derived from whatever host the app was loaded from, so a phone on the
# LAN needs no edit here.
VITE_API_PORT=3000
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/baseUrl.ts frontend/vite.config.ts frontend/.env.example frontend/scripts/test-baseUrl.mts
git commit -m "fix(frontend): follow this worktree's API port instead of assuming 3000"
```

---

### Task 8: Boot `dev-emulator.mjs` from a claimed slot

This is where the hardcoded constants and the login probe are deleted.

**Files:**
- Modify: `scripts/dev-emulator.mjs:60-61` (constants), `:210-246` (probe and backend start), `:249-264` (Metro start), `:270-285` (adb reverse and launch)
- Modify: `package.json` (add `dev:release`)
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `claimSlot`, `releaseSlot`, `takeDevice`, `releaseDevice`, `registryPath` (Tasks 2, 3, 5); `isPortFree`, `worktreeIdentity`, `readHost`, `assertResourcesAvailable`, `DEFAULT_LIMITS` (Task 4); `applySlotEnv` (Task 6); `pickLanAddress` from `scripts/lanAddress.mjs`.
- Produces: nothing.

- [ ] **Step 1: Replace the constants with a claim**

In `scripts/dev-emulator.mjs`, delete lines 60-61:

```js
const BACKEND_PORT = 3000;
const METRO_PORT = 8081;
```

Add these imports beside the existing ones:

```js
import { claimSlot, portsForSlot, readRegistry, registryPath, releaseDevice, releaseSlot, takeDevice } from "./devRegistry.mjs";
import { DEFAULT_LIMITS, assertResourcesAvailable, probePorts, readHost, worktreeIdentity } from "./devHost.mjs";
import { applySlotEnv } from "./devSlotEnv.mjs";
import { pickLanAddress } from "./lanAddress.mjs";
```

One import per module, and no `isPortFree` here — the async probe is used
through `probePorts`, and `claimSlot` takes the synchronous predicate built
from its result.

Add near the other top-level constants:

```js
const lanRequested = process.argv.includes("--lan");
let BACKEND_PORT;
let METRO_PORT;
let claimedSlot;
```

- [ ] **Step 2: Add the claim step, called first from `main()`**

Add this function above `main()`:

```js
async function claimThisWorktree() {
  const path = registryPath(repoRoot);
  const { worktree, branch, isPrimary } = worktreeIdentity(repoRoot);
  const stackCount = Object.keys(readRegistry(path).slots).length;
  assertResourcesAvailable({ stackCount, limits: DEFAULT_LIMITS, host: readHost() });

  const candidatePorts = Array.from({ length: 16 }, (_, slot) => Object.values(portsForSlot(slot))).flat();
  const freeByPort = await probePorts(candidatePorts);

  const { slot, ports } = claimSlot({
    path,
    worktree,
    branch,
    pid: process.pid,
    session: process.env.CLAUDE_SESSION ?? null,
    isPrimary,
    isPortFree: (port) => freeByPort[port] === true,
  });

  claimedSlot = slot;
  BACKEND_PORT = ports.backend;
  METRO_PORT = ports.metro;
  applySlotEnv({
    repoRoot,
    ports,
    transport: lanRequested ? "lan" : "loopback",
    lanAddress: lanRequested ? pickLanAddress() : undefined,
  });
  log(`Slot ${slot} — backend ${ports.backend}, web ${ports.vite}, Metro ${ports.metro} (${branch}).`);
}
```

Call it as the first statement inside `main()`.

- [ ] **Step 3: Delete the login probe**

Delete `probeDevLogin()` (lines 210-227, including its comment block) and replace the `if (await isPortOpen(BACKEND_PORT)) { … }` guard at the top of `ensureBackendRunning()` with:

```js
  if (await isPortOpen(BACKEND_PORT)) {
    log(`Backend already listening on ${BACKEND_PORT} for this slot.`);
    return;
  }
```

The probe existed only to tell this workflow's server apart from another worktree's on a shared port. With a claimed slot, anything on `BACKEND_PORT` is this worktree's by construction, and `claimSlot` already refused the slot if the port was externally occupied.

Remove the now-unused `DEV_PASSWORD` from the `dev-account.mjs` import if nothing else in the file uses it — check with `grep -n DEV_PASSWORD scripts/dev-emulator.mjs` before removing.

- [ ] **Step 4: Take a device lease before touching adb**

In `main()`, immediately before the first `adb` call, add:

```js
  const { worktree } = worktreeIdentity(repoRoot);
  const { avd } = takeDevice({ path: registryPath(repoRoot), worktree, pid: process.pid });
  log(`Holding ${avd}. Release it with \`npm run dev:release\` when you're done verifying.`);
```

Replace the hardcoded `AVD_NAME` at every emulator-boot call site with `avd`.

- [ ] **Step 5: Add the release script**

Create `scripts/dev-release.mjs`:

```js
// Hand back this worktree's slot and any emulator it holds. The counterpart
// to the claim dev-emulator.mjs makes at boot.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registryPath, releaseDevice, releaseSlot } from "./devRegistry.mjs";
import { worktreeIdentity } from "./devHost.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const path = registryPath(repoRoot);
const { worktree, branch } = worktreeIdentity(repoRoot);

releaseDevice({ path, worktree });
releaseSlot({ path, worktree });
console.log(`[dev-release] released the slot and any emulator held by ${branch}.`);
```

Add to `package.json` scripts:

```json
    "dev:release": "node scripts/dev-release.mjs",
```

- [ ] **Step 6: Verify end to end**

Run: `npm run test:scripts && node scripts/dev-emulator.mjs`
Expected: logs a slot line, boots, and reaches the seeded dev account. Then in a second worktree, run the same command and confirm from its log line that it claimed a *different* slot with non-overlapping ports.

Then: `npm run dev:release` in both, and confirm `cat "$(git rev-parse --path-format=absolute --git-common-dir)/scripta-dev.json"` shows empty `slots` and null `devices`.

- [ ] **Step 7: Document the rules agents must follow**

In `AGENTS.md`, under `# Rules`, add:

```markdown
- Dev servers: run `node scripts/dev-emulator.mjs` (claims this worktree's port slot) and `npm run dev:release` when done. Never hardcode 3000/8081/5173, and never kill another worktree's process to free a port.
- The emulator is leased, two at a time. Take one only to verify a change that must be rendered — layout, navigation, touch behaviour, animation, native modules. Not for backend, shared-package, type or refactor work. Write, typecheck and test with no device, then take the lease for one verification pass at the end.
```

- [ ] **Step 8: Commit**

```bash
git add scripts/dev-emulator.mjs scripts/dev-release.mjs package.json AGENTS.md
git commit -m "feat(dev): boot the emulator workflow from a claimed slot

Deletes BACKEND_PORT/METRO_PORT and the /auth/login probe that existed
only to tell this workflow's server from another worktree's on a shared
port."
```

---

## Self-review notes

**Spec coverage.** Slot scheme → Task 1. Registry, its path and locking → Task 2. Claim, release, stale reclaim → Task 3. Port-free verification and thresholds → Task 4. Device lease → Task 5. The five derived values, including `--lan` → Task 6. `strictPort` and `VITE_API_PORT` → Task 7. Deletions, agent rules and the release counterpart → Task 8.

**Not covered, deliberately.** The spec's `FRONTEND_URL` for CORS is written by Task 6 but never verified against a running backend; that is integration-tested by hand in Task 8 step 6 rather than unit-tested, since it needs a real Fastify boot.

**Carried forward.** The `session` field is written from `$CLAUDE_SESSION` in Task 8 step 2 and read by nothing until the dev-status spec's CLI is built.
