# Dev Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `npm run dev:status` — a printed snapshot of every worktree's dev stack (slot, branch, session, ports, CPU/RAM), emulator leases and host headroom — plus a LAN status page rendering the same data for a phone.

**Architecture:** One function, `collectStatus()`, joins three sources: the port-lane registry inside `.git`, a single `ps` table summed per process *tree*, and a single `lsof` listener table. Every source is an injectable default parameter, so all logic is unit-testable against fixtures with no live processes. The CLI and the page are both pure renderers over that one object, so they cannot drift.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, `node:http`, no new dependencies. Reuses `scripts/devRegistry.mjs`, `scripts/devHost.mjs`, `scripts/devTeardown.mjs`, `scripts/lanAddress.mjs`, `scripts/androidSdk.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-11-dev-status-design.md`

## Global Constraints

- **Never throws.** `dev:status` is a diagnostic. Every external call (`ps`, `lsof`, `adb`, `vm_stat`) is wrapped so a missing tool or a hung emulator degrades a field to `null`, never aborts the snapshot. The one deliberate exception is the comma-decimal `ps` guard (Task 1), which must be loud.
- **Reports, never enforces.** No killing, no blocking, no writes to the registry. Thresholds are read from `DEFAULT_LIMITS` in `scripts/devHost.mjs` (`maxStacks: 4`, `minFreeBytes: 4 GB`, `maxLoadForSecondEmulator: 8`) and only printed against.
- **Every `ps` invocation sets `LC_ALL=C`.** Verified on this machine: `ps -o pcpu` prints `0,1` under the user's locale and `0.1` under `LC_ALL=C`. A naive `parseFloat` reads every stack as idle and the tool looks like it works.
- **`ps -o comm`, never `-o command`, for the full table.** Verified on this machine: one Electron process's `command` line is ~6 KB of flags. `comm` is bounded. Command lines are read only for the ≤2 emulator pids, by targeted `ps -p <pid> -o command=`.
- **No new dependencies, no build step, no QR library.** Reuse before adding — repo rule.
- Ports derive from the slot and are never hardcoded: `backend = 3000 + 100n`, `vite = 5173 + 100n`, `metro = 8081 + 100n` via `portsForSlot()`.
- Code style follows `scripts/`: no comments except where one records a verified trap or a load-bearing "why". Root `AGENTS.md` says no comments unless asked; the why-comments specified in this plan are the asked-for exception and must be written as given.
- New tests go at `scripts/<name>.test.mjs` — that is the only path root `npm run test:scripts` globs.

## Decisions that amend the spec

Three corrections found while reading the code the spec depends on. Implement these, not the spec's original wording.

1. **`stale` is not "dead pid".** The spec says a slot with a dead recorded pid prints `stale`. That would mark almost every healthy slot: `dev-emulator.mjs` spawns the backend and Metro detached and exits, so the claiming pid is dead within seconds while the stack runs. Use the same rule `isSlotLive()` already uses: **stale = recorded pid dead AND all three of the slot's ports free.**
2. **Device serials come from the registry, not from adb.** `recordDeviceSerial()` now writes the adb serial onto the lease, so the spec's note that the tool must re-derive it is stale. Consequence: dev-status never calls `adb -s <serial> emu avd name`, whose helper in `dev-emulator.mjs` has no timeout — one hung emulator would stall the scan. Only one bounded `adb devices` call is made, purely to warn about an emulator no worktree holds.
3. **The headroom line's numbers.** The spec's example (`8.2 GB free` … `2.0 GB of 4 GB headroom`) does not self-consist. Defined here as: `headroomBytes = freeBytes - minFreeBytes`, printed as `N of 4 stacks · X.X GB above the 4 GB floor`.

---

### Task 1: Process table and subtree summation

A stack is a process *tree*, not a process. The registry records one pid per slot, but `tsx watch` supervises the real server and Metro spawns bundler workers, so the recorded pid's own RSS is a small fraction of the true cost. This task reads the `ps` table once and sums whole subtrees.

**Files:**
- Create: `scripts/devProcessTable.mjs`
- Test: `scripts/devProcessTable.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseProcessTable(output: string) -> [{ pid: number, ppid: number, rss: number, cpu: number, comm: string }]` — `rss` in KB (macOS `ps` unit), `cpu` a percentage.
  - `readProcessTable(exec = execFileSync) -> rows`
  - `childrenByPpid(rows) -> Map<number, number[]>`
  - `subtreePids(rootPid: number, childIndex: Map) -> number[]` — includes the root.
  - `sumSubtree(rootPid: number, rows) -> { rssKB: number, cpu: number, pids: number[] }`

- [ ] **Step 1: Write the failing tests**

Create `scripts/devProcessTable.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { childrenByPpid, parseProcessTable, subtreePids, sumSubtree } from "./devProcessTable.mjs";

const TABLE = [
  "  PID  PPID    RSS  %CPU COMM",
  "  100     1  10240   4.0 /usr/local/bin/node",
  "  101   100  20480   2.5 /usr/local/bin/node",
  "  102   101  30720   1.5 /usr/local/bin/node",
  "  103   100  40960   0.0 /Applications/Some App.app/Contents/MacOS/Some App",
  "  200     1   1024   0.5 /usr/sbin/unrelated",
].join("\n");

test("parseProcessTable skips the header and reads every column", () => {
  const rows = parseProcessTable(TABLE);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { pid: 100, ppid: 1, rss: 10240, cpu: 4, comm: "/usr/local/bin/node" });
});

test("parseProcessTable keeps a comm containing spaces intact", () => {
  const row = parseProcessTable(TABLE).find((r) => r.pid === 103);
  assert.equal(row.comm, "/Applications/Some App.app/Contents/MacOS/Some App");
});

test("a comma-decimal CPU is rejected loudly, never read as zero", () => {
  const localised = "  100     1  10240   4,0 /usr/local/bin/node";
  assert.throws(() => parseProcessTable(localised), /LC_ALL=C/);
});

test("sumSubtree sums a recorded pid with all of its descendants", () => {
  const { rssKB, cpu, pids } = sumSubtree(100, parseProcessTable(TABLE));
  assert.equal(rssKB, 10240 + 20480 + 30720 + 40960);
  assert.equal(cpu, 8);
  assert.deepEqual(pids.sort((a, b) => a - b), [100, 101, 102, 103]);
});

test("sumSubtree of a leaf is just that process", () => {
  assert.deepEqual(sumSubtree(200, parseProcessTable(TABLE)).pids, [200]);
});

test("sumSubtree of an unknown pid reports zero, not a throw", () => {
  assert.deepEqual(sumSubtree(999, parseProcessTable(TABLE)), { rssKB: 0, cpu: 0, pids: [] });
});

test("subtreePids survives a ppid cycle instead of looping forever", () => {
  const rows = [
    { pid: 1, ppid: 2, rss: 1, cpu: 0, comm: "a" },
    { pid: 2, ppid: 1, rss: 1, cpu: 0, comm: "b" },
  ];
  assert.deepEqual(subtreePids(1, childrenByPpid(rows)).sort(), [1, 2]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devProcessTable.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/devProcessTable.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/devProcessTable.mjs`:

```js
import { execFileSync } from "node:child_process";

// Four numeric columns then the rest of the line, because `comm` on macOS
// is a full binary path and routinely contains spaces
// ("/Applications/Some App.app/..."). Splitting on whitespace throughout
// would truncate it.
const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/;

export function parseProcessTable(output) {
  const rows = [];
  for (const line of output.split("\n")) {
    const match = ROW.exec(line);
    if (!match) continue;
    const [, pid, ppid, rss, cpu, comm] = match;
    // Verified on this machine: `ps -o pcpu` prints "0,1" under the
    // user's locale and "0.1" under LC_ALL=C. parseFloat("0,1") is 0, so
    // a silent read would report every stack as idle and the tool would
    // look like it works. Loud is the only safe failure here.
    if (cpu.includes(",")) {
      throw new Error(
        `ps reported CPU as "${cpu}" — a comma decimal. Every ps call must set LC_ALL=C (see scripts/devProcessTable.mjs).`,
      );
    }
    if (!/^\d+(?:\.\d+)?$/.test(cpu)) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), rss: Number(rss), cpu: Number(cpu), comm });
  }
  return rows;
}

export function readProcessTable(exec = execFileSync) {
  const output = exec("ps", ["-A", "-o", "pid,ppid,rss,pcpu,comm"], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseProcessTable(output);
}

export function childrenByPpid(rows) {
  const index = new Map();
  for (const row of rows) {
    const siblings = index.get(row.ppid) ?? [];
    siblings.push(row.pid);
    index.set(row.ppid, siblings);
  }
  return index;
}

export function subtreePids(rootPid, childIndex) {
  const seen = new Set();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of childIndex.get(pid) ?? []) queue.push(child);
  }
  return [...seen];
}

export function sumSubtree(rootPid, rows) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  if (!byPid.has(rootPid)) return { rssKB: 0, cpu: 0, pids: [] };
  const pids = subtreePids(rootPid, childrenByPpid(rows)).filter((pid) => byPid.has(pid));
  return {
    rssKB: pids.reduce((total, pid) => total + byPid.get(pid).rss, 0),
    cpu: Number(pids.reduce((total, pid) => total + byPid.get(pid).cpu, 0).toFixed(1)),
    pids,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/devProcessTable.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/devProcessTable.mjs scripts/devProcessTable.test.mjs
git commit -m "feat(dev): read the ps table once and sum stacks by process tree"
```

---

### Task 2: Listener table

Roles (`backend` / `vite` / `metro`) are resolved by *which pid holds which of the slot's ports*, not by guessing from a process name — every one of them is the same `node` binary. One `lsof` call yields the whole map, and the same map answers the spec's "a port in the registry that nothing is listening on" warning.

**Files:**
- Create: `scripts/devListeners.mjs`
- Test: `scripts/devListeners.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseListeners(output: string) -> { [port: number]: number[] }` — pids per listening port, deduped.
  - `readListeners(exec = execFileSync) -> { [port]: pids }` — `{}` when nothing is listening or `lsof` is unavailable.

- [ ] **Step 1: Write the failing tests**

Create `scripts/devListeners.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseListeners } from "./devListeners.mjs";

// The shape `lsof -nP -iTCP -sTCP:LISTEN -Fpn` actually prints, verified
// on this machine: a p<pid> line, then alternating f<fd>/n<name> lines
// that belong to the pid above them.
const OUTPUT = [
  "p4001",
  "f16",
  "n*:3100",
  "p4002",
  "f18",
  "n127.0.0.1:5273",
  "f20",
  "n[::1]:5273",
  "p4003",
  "f21",
  "n*:8181",
  "",
].join("\n");

test("parseListeners maps each port to the pids listening on it", () => {
  assert.deepEqual(parseListeners(OUTPUT), { 3100: [4001], 5273: [4002], 8181: [4003] });
});

test("one pid listening on both loopback families is recorded once", () => {
  assert.deepEqual(parseListeners(OUTPUT)[5273], [4002]);
});

test("two different pids on one port are both recorded", () => {
  const rival = ["p4002", "f18", "n*:5273", "p9999", "f18", "n*:5273"].join("\n");
  assert.deepEqual(parseListeners(rival)[5273], [4002, 9999]);
});

test("empty output is an empty map, not a throw", () => {
  assert.deepEqual(parseListeners(""), {});
});

test("a name line with no port is ignored", () => {
  assert.deepEqual(parseListeners(["p1", "f3", "n/dev/null"].join("\n")), {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devListeners.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/devListeners.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/devListeners.mjs`:

```js
import { execFileSync } from "node:child_process";

// -Fpn emits one p<pid> line followed by the f<fd>/n<name> lines for that
// pid, so the current pid has to be carried down the loop. Names come in
// three shapes — "*:3100", "127.0.0.1:5273" and "[::1]:5273" — and the
// port is the tail of all three, which is why this splits on the LAST
// colon rather than parsing the address.
export function parseListeners(output) {
  const byPort = {};
  let pid;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
      continue;
    }
    if (!line.startsWith("n") || pid === undefined) continue;
    const port = Number(line.slice(line.lastIndexOf(":") + 1));
    if (!Number.isInteger(port)) continue;
    const pids = (byPort[port] ??= []);
    if (!pids.includes(pid)) pids.push(pid);
  }
  return byPort;
}

export function readListeners(exec = execFileSync) {
  try {
    return parseListeners(exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8" }));
  } catch (error) {
    // lsof exits 1 with empty output when nothing is listening at all —
    // the normal empty case, not a failure. A missing lsof lands here
    // too, and this tool must degrade rather than abort.
    if (error.status === 1) return {};
    return {};
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/devListeners.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/devListeners.mjs scripts/devListeners.test.mjs
git commit -m "feat(dev): resolve port listeners from one lsof table"
```

---

### Task 3: Device rows, and a timeout on the emulator's adb calls

Amendment 2 in force: leases already carry their adb serial, so device rows are read from the registry. `adb devices` is called once — bounded by a timeout — only to spot an emulator running that no worktree holds. This task also fixes `dev-emulator.mjs`'s unbounded `run()`, which is the reason dev-status must not make per-serial adb calls at all.

**Files:**
- Create: `scripts/devDevices.mjs`
- Test: `scripts/devDevices.test.mjs`
- Modify: `scripts/devRegistry.mjs` (add `branchForWorktree`, beside `slotForWorktree`)
- Modify: `scripts/dev-emulator.mjs:112-114` (`run()` gains a timeout)

**Interfaces:**
- Consumes: `parseProcessTable` rows and `sumSubtree` from Task 1; `AVDS` from `scripts/devRegistry.mjs`.
- Produces:
  - `branchForWorktree(registry, worktree) -> string | undefined` (in `devRegistry.mjs`)
  - `parseAdbDevices(output) -> string[]`
  - `readAdbSerials({ exec, timeoutMs }) -> string[]` — `[]` on any failure.
  - `readCommandForPid(pid, exec) -> string | undefined`
  - `collectDevices({ registry, rows, commandForPid, now }) -> [{ avd, serial, holder, worktree, takenAt, heldMs, rssMB }]` — one row per AVD in `AVDS`, held or free.
  - `orphanSerials(registry, serials) -> string[]`

- [ ] **Step 1: Write the failing tests**

Create `scripts/devDevices.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDevices, orphanSerials, parseAdbDevices } from "./devDevices.mjs";

const NOW = Date.parse("2026-09-14T15:00:00.000Z");

function registryWithLease(extra = {}) {
  return {
    version: 1,
    slots: { 5: { worktree: "/wt/5a", branch: "mobile/5a-library", pid: 1, session: "5a-library", claimedAt: "x" } },
    devices: {
      "scripta-dev-0": { worktree: "/wt/5a", pid: 1, takenAt: "2026-09-14T14:42:00.000Z", serial: "emulator-5554" },
      "scripta-dev-1": null,
      ...extra,
    },
  };
}

test("parseAdbDevices keeps only serials in device state", () => {
  const output = ["List of devices attached", "emulator-5554\tdevice", "emulator-5556\toffline", ""].join("\n");
  assert.deepEqual(parseAdbDevices(output), ["emulator-5554"]);
});

test("a held device reports its serial and holding branch from the registry", () => {
  const [held] = collectDevices({ registry: registryWithLease(), now: NOW });
  assert.equal(held.avd, "scripta-dev-0");
  assert.equal(held.serial, "emulator-5554");
  assert.equal(held.holder, "mobile/5a-library");
  assert.equal(held.heldMs, 18 * 60 * 1000);
});

test("a free AVD is still listed, with nulls", () => {
  const free = collectDevices({ registry: registryWithLease(), now: NOW })[1];
  assert.deepEqual(free, { avd: "scripta-dev-1", serial: null, holder: null, worktree: null, takenAt: null, heldMs: null, rssMB: null });
});

test("a lease whose worktree holds no slot falls back to the worktree path", () => {
  const registry = registryWithLease();
  registry.slots = {};
  assert.equal(collectDevices({ registry, now: NOW })[0].holder, "/wt/5a");
});

test("emulator memory is summed over the qemu subtree and matched by -avd", () => {
  const rows = [
    { pid: 700, ppid: 1, rss: 2_097_152, cpu: 30, comm: "/opt/android/emulator/qemu/darwin-aarch64/qemu-system-aarch64" },
    { pid: 701, ppid: 700, rss: 1_048_576, cpu: 5, comm: "/opt/android/emulator/qemu/darwin-aarch64/qemu-system-aarch64" },
  ];
  const commandForPid = (pid) => (pid === 700 ? "qemu-system-aarch64 -avd scripta-dev-0 -no-audio" : undefined);
  const [held] = collectDevices({ registry: registryWithLease(), rows, commandForPid, now: NOW });
  assert.equal(held.rssMB, 3072);
});

test("an emulator whose AVD cannot be resolved contributes no memory", () => {
  const rows = [{ pid: 700, ppid: 1, rss: 2_097_152, cpu: 30, comm: "/opt/android/emulator/qemu/darwin-aarch64/qemu-system-aarch64" }];
  const [held] = collectDevices({ registry: registryWithLease(), rows, commandForPid: () => undefined, now: NOW });
  assert.equal(held.rssMB, null);
});

test("a running serial that matches no lease is an orphan", () => {
  assert.deepEqual(orphanSerials(registryWithLease(), ["emulator-5554", "emulator-5556"]), ["emulator-5556"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devDevices.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/devDevices.mjs`

- [ ] **Step 3: Add `branchForWorktree` to the registry**

In `scripts/devRegistry.mjs`, directly below `slotForWorktree`:

```js
export function branchForWorktree(registry, worktree) {
  const slot = slotForWorktree(registry, worktree);
  return slot === undefined ? undefined : registry.slots[slot].branch;
}
```

- [ ] **Step 4: Write the device module**

Create `scripts/devDevices.mjs`:

```js
import { execFileSync } from "node:child_process";
import { androidEnv } from "./androidSdk.mjs";
import { sumSubtree } from "./devProcessTable.mjs";
import { AVDS, branchForWorktree } from "./devRegistry.mjs";

const EMULATOR_COMM = /qemu-system|\/emulator\/emulator$/;

export function parseAdbDevices(output) {
  return output
    .split("\n")
    .filter((line) => /^emulator-\d+\s+device\b/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

// One bounded `adb devices` call and nothing else. Resolving a serial to
// its AVD name would mean `adb -s <serial> emu avd name` per device, and
// a hung emulator answers that never — which is exactly why the serial is
// recorded on the lease at take time (devRegistry.recordDeviceSerial)
// instead of being re-derived here.
export function readAdbSerials({ exec = execFileSync, timeoutMs = 5000 } = {}) {
  try {
    const output = exec("adb", ["devices"], {
      encoding: "utf8",
      timeout: timeoutMs,
      env: { ...process.env, ...androidEnv(), LC_ALL: "C" },
    });
    return parseAdbDevices(output ?? "");
  } catch {
    return [];
  }
}

// `ps -o command` for the whole table would be unusable — one Electron
// process prints ~6 KB of flags — but it is the only place the AVD name
// appears, so it is read for emulator pids alone.
export function readCommandForPid(pid, exec = execFileSync) {
  try {
    return exec("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
  } catch {
    return undefined;
  }
}

function avdForPid(pid, commandForPid) {
  const match = /-avd\s+(\S+)/.exec(commandForPid(pid) ?? "");
  return match ? match[1] : undefined;
}

export function collectDevices({ registry, rows = [], commandForPid = readCommandForPid, now = Date.now() }) {
  const rssKBByAvd = {};
  for (const row of rows) {
    if (!EMULATOR_COMM.test(row.comm)) continue;
    const avd = avdForPid(row.pid, commandForPid);
    if (avd === undefined) continue;
    rssKBByAvd[avd] = (rssKBByAvd[avd] ?? 0) + sumSubtree(row.pid, rows).rssKB;
  }

  return AVDS.map((avd) => {
    const lease = registry.devices[avd] ?? null;
    const rssKB = rssKBByAvd[avd];
    return {
      avd,
      serial: lease?.serial ?? null,
      holder: lease ? (branchForWorktree(registry, lease.worktree) ?? lease.worktree) : null,
      worktree: lease?.worktree ?? null,
      takenAt: lease?.takenAt ?? null,
      heldMs: lease?.takenAt ? now - Date.parse(lease.takenAt) : null,
      rssMB: rssKB === undefined ? null : Math.round(rssKB / 1024),
    };
  });
}

export function orphanSerials(registry, serials) {
  const leased = new Set(
    Object.values(registry.devices)
      .map((lease) => lease?.serial)
      .filter(Boolean),
  );
  return serials.filter((serial) => !leased.has(serial));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/devDevices.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Bound `dev-emulator.mjs`'s adb calls**

Replace `scripts/dev-emulator.mjs:112-114` with:

```js
// Bounded, because `adb -s <serial> emu avd name` never answers for a
// hung emulator and this helper is called inside a poll loop. spawnSync
// returns stdout/stderr as null when it kills a timed-out child, so both
// are normalised — every caller here does string work on them.
function run(command, args, { env, timeoutMs = 15_000 } = {}) {
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: timeoutMs });
  return { ...result, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
```

- [ ] **Step 7: Verify the emulator script still parses and its tests pass**

Run: `node --check scripts/dev-emulator.mjs && node --test scripts/dev-emulator.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/devDevices.mjs scripts/devDevices.test.mjs scripts/devRegistry.mjs scripts/dev-emulator.mjs
git commit -m "feat(dev): read device rows from the lease, and bound adb calls with a timeout"
```

---

### Task 4: `collectStatus()`

The join. Everything both surfaces render, from injectable sources.

**Files:**
- Create: `scripts/devStatus.mjs`
- Test: `scripts/devStatus.test.mjs`

**Interfaces:**
- Consumes: `readProcessTable`/`sumSubtree` (Task 1), `readListeners` (Task 2), `collectDevices`/`readAdbSerials`/`orphanSerials` (Task 3), `readHost`/`DEFAULT_LIMITS` (`devHost.mjs`), `processCwd` (`devTeardown.mjs`), `pickLanAddress` (`lanAddress.mjs`), `portsForSlot`/`readRegistry`/`registryPath`/`isPidAlive` (`devRegistry.mjs`).
- Produces:
  - `connectionUrls({ ports, lanAddress }) -> { webLocal, webLan, expoLan, expoEmulator }` — the LAN pair is `null` when no LAN address resolved.
  - `slotState({ entry, ports, listeners }) -> "live" | "stale"`
  - `auditPorts({ ports, listeners, worktree, cwdForPid }) -> [{ role, port, pids, foreignPids }]`
  - `buildStacks({ registry, rows, listeners, lanAddress, cwdForPid }) -> stacks[]`
  - `collectStatus(options) -> { host, stacks, devices, orphans, limits, warnings }` — `warnings` is filled in by Task 5; leave it `[]` here.

A stack: `{ slot, worktree, branch, session, claimedAt, state, ports, processes: [{ pid, role, rss, cpu, alive }], rssTotalMB, cpuTotal, portAudit, urls }`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/devStatus.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPorts, buildStacks, connectionUrls, slotState } from "./devStatus.mjs";
import { portsForSlot } from "./devRegistry.mjs";

test("URLs for slot 0 use the familiar ports", () => {
  assert.deepEqual(connectionUrls({ ports: portsForSlot(0), lanAddress: "192.168.1.24" }), {
    webLocal: "http://localhost:5173",
    webLan: "http://192.168.1.24:5173",
    expoLan: "exp://192.168.1.24:8081",
    expoEmulator: "exp://127.0.0.1:8081",
  });
});

test("URLs for slot 15 use its derived ports", () => {
  assert.deepEqual(connectionUrls({ ports: portsForSlot(15), lanAddress: "192.168.1.24" }), {
    webLocal: "http://localhost:6673",
    webLan: "http://192.168.1.24:6673",
    expoLan: "exp://192.168.1.24:9581",
    expoEmulator: "exp://127.0.0.1:9581",
  });
});

test("with no LAN address the local URLs still resolve and the LAN ones are null", () => {
  const urls = connectionUrls({ ports: portsForSlot(2), lanAddress: undefined });
  assert.equal(urls.webLocal, "http://localhost:5373");
  assert.equal(urls.webLan, null);
  assert.equal(urls.expoLan, null);
});

const PORTS = portsForSlot(2);

test("a slot whose pid is dead but whose ports are bound is live, not stale", () => {
  const state = slotState({ entry: { pid: 999_999 }, ports: PORTS, listeners: { [PORTS.metro]: [4242] } });
  assert.equal(state, "live");
});

test("a slot with a dead pid and no listeners is stale", () => {
  assert.equal(slotState({ entry: { pid: 999_999 }, ports: PORTS, listeners: {} }), "stale");
});

test("a slot whose recorded pid is alive is live", () => {
  assert.equal(slotState({ entry: { pid: process.pid }, ports: PORTS, listeners: {} }), "live");
});

test("auditPorts reports an unlistened port and a foreign holder separately", () => {
  const audit = auditPorts({
    ports: PORTS,
    listeners: { [PORTS.backend]: [11], [PORTS.vite]: [22] },
    worktree: "/wt/mine",
    cwdForPid: (pid) => (pid === 11 ? "/wt/mine/backend" : "/wt/other"),
  });
  assert.deepEqual(audit.find((a) => a.role === "backend"), { role: "backend", port: PORTS.backend, pids: [11], foreignPids: [] });
  assert.deepEqual(audit.find((a) => a.role === "vite").foreignPids, [{ pid: 22, cwd: "/wt/other" }]);
  assert.deepEqual(audit.find((a) => a.role === "metro").pids, []);
});

test("a pid whose cwd cannot be resolved is not called foreign", () => {
  const audit = auditPorts({
    ports: PORTS,
    listeners: { [PORTS.backend]: [11] },
    worktree: "/wt/mine",
    cwdForPid: () => undefined,
  });
  assert.deepEqual(audit.find((a) => a.role === "backend").foreignPids, []);
});

const REGISTRY = {
  version: 1,
  slots: {
    2: {
      worktree: "/wt/4d",
      branch: "mobile/4d-design-system",
      pid: 500,
      session: "4d-design-system",
      claimedAt: "2026-09-14T14:00:00.000Z",
    },
  },
  devices: { "scripta-dev-0": null, "scripta-dev-1": null },
};

const ROWS = [
  { pid: 500, ppid: 1, rss: 102_400, cpu: 4, comm: "/usr/local/bin/node" },
  { pid: 501, ppid: 500, rss: 204_800, cpu: 8, comm: "/usr/local/bin/node" },
  { pid: 600, ppid: 1, rss: 51_200, cpu: 2, comm: "/usr/local/bin/node" },
];

test("a stack sums its whole process tree, in MB", () => {
  const [stack] = buildStacks({
    registry: REGISTRY,
    rows: ROWS,
    listeners: { [portsForSlot(2).backend]: [501] },
    lanAddress: "192.168.1.24",
    cwdForPid: () => "/wt/4d",
  });
  assert.equal(stack.rssTotalMB, 300);
  assert.equal(stack.cpuTotal, 12);
});

test("a stack labels each listening pid with the role its port implies", () => {
  const ports = portsForSlot(2);
  const [stack] = buildStacks({
    registry: REGISTRY,
    rows: ROWS,
    listeners: { [ports.backend]: [501], [ports.metro]: [600] },
    lanAddress: "192.168.1.24",
    cwdForPid: () => "/wt/4d",
  });
  assert.equal(stack.processes.find((p) => p.pid === 501).role, "backend");
  assert.equal(stack.processes.find((p) => p.pid === 500).role, "other");
  assert.equal(stack.slot, 2);
  assert.equal(stack.branch, "mobile/4d-design-system");
  assert.equal(stack.session, "4d-design-system");
});

test("a stack with a dead pid and free ports is reported, marked stale, not dropped", () => {
  const registry = { ...REGISTRY, slots: { 7: { ...REGISTRY.slots[2], pid: 999_999 } } };
  const [stack] = buildStacks({ registry, rows: [], listeners: {}, lanAddress: undefined, cwdForPid: () => undefined });
  assert.equal(stack.state, "stale");
  assert.equal(stack.rssTotalMB, 0);
});

test("stacks come back in slot order", () => {
  const registry = {
    ...REGISTRY,
    slots: { 5: { ...REGISTRY.slots[2] }, 0: { ...REGISTRY.slots[2] }, 2: { ...REGISTRY.slots[2] } },
  };
  const stacks = buildStacks({ registry, rows: [], listeners: {}, lanAddress: undefined, cwdForPid: () => undefined });
  assert.deepEqual(stacks.map((s) => s.slot), [0, 2, 5]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devStatus.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/devStatus.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/devStatus.mjs`:

```js
import { cpus, loadavg, totalmem } from "node:os";
import { collectDevices, orphanSerials, readAdbSerials } from "./devDevices.mjs";
import { DEFAULT_LIMITS, readHost } from "./devHost.mjs";
import { readListeners } from "./devListeners.mjs";
import { readProcessTable, sumSubtree } from "./devProcessTable.mjs";
import { isPidAlive, portsForSlot, readRegistry, registryPath } from "./devRegistry.mjs";
import { processCwd } from "./devTeardown.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

export function connectionUrls({ ports, lanAddress }) {
  return {
    webLocal: `http://localhost:${ports.vite}`,
    webLan: lanAddress ? `http://${lanAddress}:${ports.vite}` : null,
    expoLan: lanAddress ? `exp://${lanAddress}:${ports.metro}` : null,
    expoEmulator: `exp://127.0.0.1:${ports.metro}`,
  };
}

// The same rule isSlotLive() claims by: a dead recorded pid is NOT enough
// to call a slot stale. dev-emulator.mjs spawns the backend and Metro
// detached and then exits, so the claiming pid is gone within seconds
// while the stack it started keeps its ports bound. Stale means dead pid
// AND nothing listening on any of the three ports — a worktree that
// crashed before binding anything.
export function slotState({ entry, ports, listeners }) {
  if (isPidAlive(entry.pid)) return "live";
  const bound = Object.values(ports).some((port) => (listeners[port] ?? []).length > 0);
  return bound ? "live" : "stale";
}

export function auditPorts({ ports, listeners, worktree, cwdForPid }) {
  return [
    ["backend", ports.backend],
    ["vite", ports.vite],
    ["metro", ports.metro],
  ].map(([role, port]) => {
    const pids = listeners[port] ?? [];
    const foreignPids = pids.flatMap((pid) => {
      const cwd = cwdForPid(pid);
      // An unresolvable cwd is never reported as foreign: the same
      // safe-default devTeardown.pidsToTeardown takes, for the same
      // reason — a false accusation here sends someone hunting a
      // collision that isn't there.
      if (typeof cwd !== "string" || cwd.length === 0) return [];
      const inside = cwd === worktree || cwd.startsWith(`${worktree}/`);
      return inside ? [] : [{ pid, cwd }];
    });
    return { role, port, pids, foreignPids };
  });
}

export function buildStacks({ registry, rows, listeners, lanAddress, cwdForPid = processCwd }) {
  return Object.keys(registry.slots)
    .map(Number)
    .sort((a, b) => a - b)
    .map((slot) => {
      const entry = registry.slots[String(slot)];
      const ports = portsForSlot(slot);
      const portAudit = auditPorts({ ports, listeners, worktree: entry.worktree, cwdForPid });

      const roleByPid = new Map(portAudit.flatMap(({ role, pids }) => pids.map((pid) => [pid, role])));
      // Every pid the slot owns: the recorded claimer's subtree plus each
      // listener's subtree. They are usually disjoint — the claimer exits
      // and the servers it spawned are reparented to launchd — so both
      // roots must be walked, and the union deduped.
      const roots = [entry.pid, ...portAudit.flatMap(({ pids }) => pids)];
      const byPid = new Map(rows.map((row) => [row.pid, row]));
      const owned = new Map();
      for (const root of roots) {
        for (const pid of sumSubtree(root, rows).pids) owned.set(pid, byPid.get(pid));
      }

      const processes = [...owned.values()].map((row) => ({
        pid: row.pid,
        role: roleByPid.get(row.pid) ?? "other",
        rss: row.rss,
        cpu: row.cpu,
        alive: true,
      }));

      return {
        slot,
        worktree: entry.worktree,
        branch: entry.branch,
        session: entry.session ?? null,
        claimedAt: entry.claimedAt ?? null,
        state: slotState({ entry, ports, listeners }),
        ports,
        processes,
        rssTotalMB: Math.round(processes.reduce((total, p) => total + p.rss, 0) / 1024),
        cpuTotal: Number(processes.reduce((total, p) => total + p.cpu, 0).toFixed(1)),
        portAudit,
        urls: connectionUrls({ ports, lanAddress }),
      };
    });
}

export function collectStatus({
  repoRoot = process.cwd(),
  registry = readRegistry(registryPath(repoRoot)),
  rows = readProcessTable(),
  listeners = readListeners(),
  serials = readAdbSerials(),
  hostReading = readHost(),
  lanAddress = pickLanAddress(),
  limits = DEFAULT_LIMITS,
  cwdForPid = processCwd,
  now = Date.now(),
} = {}) {
  const host = {
    lanAddress: lanAddress ?? null,
    totalMemGB: Number((totalmem() / 1024 ** 3).toFixed(1)),
    freeMemGB: Number((hostReading.freeBytes / 1024 ** 3).toFixed(1)),
    freeBytes: hostReading.freeBytes,
    loadAvg1: Number(loadavg()[0].toFixed(2)),
    cores: cpus().length,
  };
  const stacks = buildStacks({ registry, rows, listeners, lanAddress, cwdForPid });
  const devices = collectDevices({ registry, rows, now });
  return { host, stacks, devices, orphans: orphanSerials(registry, serials), limits, warnings: [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/devStatus.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Smoke-test against the real machine**

Run: `node -e 'import("./scripts/devStatus.mjs").then(({collectStatus}) => console.log(JSON.stringify(collectStatus({repoRoot: process.cwd()}).host, null, 2)))'`
Expected: a host object with a plausible LAN address, non-zero `totalMemGB`, `freeMemGB` and `cores`. No throw.

- [ ] **Step 6: Commit**

```bash
git add scripts/devStatus.mjs scripts/devStatus.test.mjs
git commit -m "feat(dev): collectStatus joins the registry, ps and lsof into one snapshot"
```

---

### Task 5: Warnings

Printed under the table, never thrown. Thresholds come from `DEFAULT_LIMITS`, so the tool and the boot gate can never disagree.

**Files:**
- Modify: `scripts/devStatus.mjs` (add `statusWarnings`, call it from `collectStatus`)
- Modify: `scripts/devStatus.test.mjs` (append)

**Interfaces:**
- Consumes: the status object from Task 4.
- Produces: `statusWarnings({ host, stacks, devices, orphans, limits, now }) -> string[]`; `collectStatus().warnings` is now populated. Exported constant `DEVICE_LEASE_WARN_MS = 30 * 60 * 1000`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/devStatus.test.mjs`:

```js
import { statusWarnings } from "./devStatus.mjs";
import { DEFAULT_LIMITS } from "./devHost.mjs";

const HEALTHY = {
  host: { freeBytes: 8 * 1024 ** 3, loadAvg1: 2, lanAddress: "192.168.1.24" },
  stacks: [],
  devices: [],
  orphans: [],
  limits: DEFAULT_LIMITS,
  now: Date.now(),
};

test("a healthy host warns about nothing", () => {
  assert.deepEqual(statusWarnings(HEALTHY), []);
});

test("free memory exactly at the floor does not warn, below it does", () => {
  assert.deepEqual(statusWarnings({ ...HEALTHY, host: { ...HEALTHY.host, freeBytes: DEFAULT_LIMITS.minFreeBytes } }), []);
  const below = statusWarnings({ ...HEALTHY, host: { ...HEALTHY.host, freeBytes: DEFAULT_LIMITS.minFreeBytes - 1 } });
  assert.equal(below.length, 1);
  assert.match(below[0], /memory/i);
});

test("load exactly at the emulator limit does not warn, above it does", () => {
  assert.deepEqual(statusWarnings({ ...HEALTHY, host: { ...HEALTHY.host, loadAvg1: DEFAULT_LIMITS.maxLoadForSecondEmulator } }), []);
  const above = statusWarnings({ ...HEALTHY, host: { ...HEALTHY.host, loadAvg1: DEFAULT_LIMITS.maxLoadForSecondEmulator + 0.1 } });
  assert.match(above[0], /load/i);
});

test("a stale slot warns by branch and names dev:release", () => {
  const warnings = statusWarnings({
    ...HEALTHY,
    stacks: [{ slot: 3, branch: "mobile/x", state: "stale", portAudit: [] }],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /slot 3/);
  assert.match(warnings[0], /dev:release/);
});

test("a live slot with a port nothing is listening on warns", () => {
  const warnings = statusWarnings({
    ...HEALTHY,
    stacks: [
      {
        slot: 2,
        branch: "mobile/x",
        state: "live",
        portAudit: [
          { role: "backend", port: 3200, pids: [1], foreignPids: [] },
          { role: "metro", port: 8281, pids: [], foreignPids: [] },
        ],
      },
    ],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /8281/);
});

test("a stale slot does not also warn about each of its silent ports", () => {
  const warnings = statusWarnings({
    ...HEALTHY,
    stacks: [{ slot: 3, branch: "mobile/x", state: "stale", portAudit: [{ role: "backend", port: 3300, pids: [], foreignPids: [] }] }],
  });
  assert.equal(warnings.length, 1);
});

test("a port held by another worktree's process warns with that cwd", () => {
  const warnings = statusWarnings({
    ...HEALTHY,
    stacks: [
      {
        slot: 2,
        branch: "mobile/x",
        state: "live",
        portAudit: [
          { role: "backend", port: 3200, pids: [9], foreignPids: [{ pid: 9, cwd: "/wt/other" }] },
          { role: "vite", port: 5373, pids: [1], foreignPids: [] },
          { role: "metro", port: 8281, pids: [1], foreignPids: [] },
        ],
      },
    ],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\/wt\/other/);
});

test("a device held past 30 minutes warns, at 30 it does not", () => {
  const device = (heldMs) => ({ avd: "scripta-dev-0", holder: "mobile/x", heldMs });
  assert.deepEqual(statusWarnings({ ...HEALTHY, devices: [device(30 * 60 * 1000)] }), []);
  const warnings = statusWarnings({ ...HEALTHY, devices: [device(31 * 60 * 1000)] });
  assert.match(warnings[0], /scripta-dev-0/);
});

test("an emulator no lease accounts for warns", () => {
  const warnings = statusWarnings({ ...HEALTHY, orphans: ["emulator-5556"] });
  assert.match(warnings[0], /emulator-5556/);
});

test("no LAN address warns, since every phone URL depends on it", () => {
  const warnings = statusWarnings({ ...HEALTHY, host: { ...HEALTHY.host, lanAddress: null } });
  assert.match(warnings[0], /LAN/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devStatus.test.mjs`
Expected: FAIL — `statusWarnings is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Append to `scripts/devStatus.mjs`:

```js
export const DEVICE_LEASE_WARN_MS = 30 * 60 * 1000;

export function statusWarnings({ host, stacks, devices, orphans, limits = DEFAULT_LIMITS, now = Date.now() }) {
  const warnings = [];

  if (host.freeBytes < limits.minFreeBytes) {
    warnings.push(
      `only ${(host.freeBytes / 1024 ** 3).toFixed(1)} GB of memory available — ` +
        `below the ${(limits.minFreeBytes / 1024 ** 3).toFixed(0)} GB floor, so the next stack will be refused at boot.`,
    );
  }
  if (host.loadAvg1 > limits.maxLoadForSecondEmulator) {
    warnings.push(
      `1-minute load average is ${host.loadAvg1.toFixed(1)} — above the ${limits.maxLoadForSecondEmulator} limit for a second emulator.`,
    );
  }
  if (!host.lanAddress) {
    warnings.push("no LAN address resolved — phone URLs are unavailable until this machine has one.");
  }

  for (const stack of stacks) {
    if (stack.state === "stale") {
      // Only one warning for a stale slot: its ports are silent by
      // definition, so also listing each silent port would be three
      // lines saying the same thing.
      warnings.push(`slot ${stack.slot} (${stack.branch}) is stale — its pid is gone and nothing holds its ports. Run \`npm run dev:release\` in that worktree.`);
      continue;
    }
    for (const { role, port, pids, foreignPids } of stack.portAudit) {
      if (pids.length === 0) {
        warnings.push(`slot ${stack.slot} (${stack.branch}) claims ${role} :${port}, but nothing is listening on it.`);
      }
      for (const { pid, cwd } of foreignPids) {
        warnings.push(`slot ${stack.slot} (${stack.branch}) claims ${role} :${port}, but pid ${pid} holds it from ${cwd}.`);
      }
    }
  }

  for (const device of devices) {
    if (device.heldMs !== null && device.heldMs > DEVICE_LEASE_WARN_MS) {
      warnings.push(
        `${device.avd} has been held by ${device.holder} for ${Math.round(device.heldMs / 60000)} minutes — likely a forgotten lease.`,
      );
    }
  }
  for (const serial of orphans) {
    warnings.push(`${serial} is running but no worktree holds a lease on it.`);
  }

  return warnings;
}
```

Then, in `collectStatus`, replace the `return` statement's `warnings: []` so the warnings are computed from the values just built:

```js
  const devices = collectDevices({ registry, rows, now });
  const orphans = orphanSerials(registry, serials);
  const warnings = statusWarnings({ host, stacks, devices, orphans, limits, now });
  return { host, stacks, devices, orphans, limits, warnings };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/devStatus.test.mjs`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/devStatus.mjs scripts/devStatus.test.mjs
git commit -m "feat(dev): warn on low memory, load, stale slots, port mismatches and forgotten leases"
```

---

### Task 6: The CLI

`npm run dev:status`. A pure renderer plus a thin entry point.

**Files:**
- Create: `scripts/devStatusRender.mjs`
- Create: `scripts/dev-status.mjs`
- Test: `scripts/devStatusRender.test.mjs`
- Modify: `package.json` (add the `dev:status` script)

**Interfaces:**
- Consumes: `collectStatus()` (Tasks 4–5), `worktreeIdentity` (`devHost.mjs`).
- Produces:
  - `formatTable(headers: string[], rows: string[][]) -> string` — right-pads to the widest cell per column.
  - `renderStatus(status) -> string`
  - `renderWorktree(status, worktreePath) -> string`

- [ ] **Step 1: Write the failing tests**

Create `scripts/devStatusRender.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTable, renderStatus, renderWorktree } from "./devStatusRender.mjs";
import { DEFAULT_LIMITS } from "./devHost.mjs";

const STATUS = {
  host: { lanAddress: "192.168.1.24", totalMemGB: 31.9, freeMemGB: 8.2, freeBytes: 8.2 * 1024 ** 3, loadAvg1: 3.4, cores: 10 },
  limits: DEFAULT_LIMITS,
  orphans: [],
  warnings: ["slot 3 (mobile/y) is stale — run `npm run dev:release` in that worktree."],
  stacks: [
    {
      slot: 2,
      worktree: "/wt/4d",
      branch: "mobile/4d-design-system",
      session: "4d-design-system",
      state: "live",
      ports: { backend: 3200, vite: 5373, metro: 8281 },
      processes: [],
      rssTotalMB: 704,
      cpuTotal: 22,
      portAudit: [],
      urls: {
        webLocal: "http://localhost:5373",
        webLan: "http://192.168.1.24:5373",
        expoLan: "exp://192.168.1.24:8281",
        expoEmulator: "exp://127.0.0.1:8281",
      },
    },
  ],
  devices: [
    { avd: "scripta-dev-0", serial: "emulator-5554", holder: "mobile/5a-library", takenAt: "2026-09-14T14:31:00.000Z", heldMs: 18 * 60 * 1000, rssMB: 2048 },
    { avd: "scripta-dev-1", serial: null, holder: null, takenAt: null, heldMs: null, rssMB: null },
  ],
};

test("formatTable pads every column to its widest cell", () => {
  const out = formatTable(["A", "BBBB"], [["aaa", "b"]]);
  const [header, row] = out.split("\n");
  assert.match(header, /^ A {3}BBBB$/);
  assert.match(row, /^ aaa b {3}$/);
});

test("renderStatus prints the host line, the slot row and its ports", () => {
  const out = renderStatus(STATUS);
  assert.match(out, /192\.168\.1\.24/);
  assert.match(out, /31\.9 GB total/);
  assert.match(out, /10 cores/);
  assert.match(out, /mobile\/4d-design-system/);
  assert.match(out, /3200/);
  assert.match(out, /5373/);
  assert.match(out, /8281/);
  assert.match(out, /704 MB/);
  assert.match(out, /22%/);
});

test("renderStatus prints device holders and marks a free AVD free", () => {
  const out = renderStatus(STATUS);
  assert.match(out, /scripta-dev-0\s+emulator-5554\s+mobile\/5a-library\s+\d\d:\d\d \(18m\)/);
  assert.match(out, /scripta-dev-1\s+.*free/);
});

test("renderStatus prints the headroom line against the boot floor", () => {
  assert.match(renderStatus(STATUS), /1 of 4 stacks · 4\.2 GB above the 4 GB floor/);
});

test("renderStatus prints warnings under the table, marked", () => {
  const out = renderStatus(STATUS);
  assert.match(out, /warning/i);
  assert.match(out, /slot 3 \(mobile\/y\) is stale/);
});

test("renderStatus marks a stale slot in its own row", () => {
  const stale = { ...STATUS, stacks: [{ ...STATUS.stacks[0], state: "stale" }] };
  assert.match(renderStatus(stale), /stale/);
});

test("renderStatus with zero stacks says so instead of printing an empty table", () => {
  const empty = { ...STATUS, stacks: [], warnings: [] };
  const out = renderStatus(empty);
  assert.match(out, /no stacks running/i);
  assert.match(out, /0 of 4 stacks/);
});

test("renderWorktree prints all four connection URLs for that worktree's slot", () => {
  const out = renderWorktree(STATUS, "/wt/4d");
  assert.match(out, /mobile\/4d-design-system · slot 2/);
  assert.match(out, /http:\/\/localhost:5373/);
  assert.match(out, /http:\/\/192\.168\.1\.24:5373/);
  assert.match(out, /exp:\/\/192\.168\.1\.24:8281/);
  assert.match(out, /exp:\/\/127\.0\.0\.1:8281/);
  assert.match(out, /adb reverse tcp:8281/);
});

test("renderWorktree on a worktree holding no slot says so rather than throwing", () => {
  assert.match(renderWorktree(STATUS, "/wt/nothing"), /holds no slot/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devStatusRender.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/devStatusRender.mjs`

- [ ] **Step 3: Write the renderer**

Create `scripts/devStatusRender.mjs`:

```js
export function formatTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
  const line = (cells) => ` ${cells.map((cell, column) => String(cell ?? "").padEnd(widths[column])).join(" ")}`;
  return [line(headers), ...rows.map(line)].join("\n");
}

function minutes(ms) {
  return `${Math.round(ms / 60000)}m`;
}

function clockTime(iso) {
  return iso ? new Date(iso).toTimeString().slice(0, 5) : "—";
}

export function renderStatus(status) {
  const { host, stacks, devices, limits, warnings } = status;
  const headroomGB = (host.freeBytes - limits.minFreeBytes) / 1024 ** 3;
  const floorGB = (limits.minFreeBytes / 1024 ** 3).toFixed(0);

  const sections = [
    `scripta dev · ${host.lanAddress ?? "no LAN address"} · ${host.totalMemGB} GB total, ${host.freeMemGB} GB free · load ${host.loadAvg1.toFixed(1)} / ${host.cores} cores`,
    "",
  ];

  if (stacks.length === 0) {
    sections.push(" no stacks running.", "");
  } else {
    sections.push(
      formatTable(
        ["SLOT", "BRANCH", "SESSION", "API", "WEB", "METRO", "RSS", "CPU"],
        stacks.map((stack) => [
          stack.state === "stale" ? `${stack.slot} stale` : String(stack.slot),
          stack.branch,
          stack.session ?? "—",
          String(stack.ports.backend),
          String(stack.ports.vite),
          String(stack.ports.metro),
          `${stack.rssTotalMB} MB`,
          `${stack.cpuTotal}%`,
        ]),
      ),
      "",
    );
  }

  sections.push(
    formatTable(
      ["DEVICE", "SERIAL", "HELD BY", "SINCE"],
      devices.map((device) =>
        device.holder
          ? [device.avd, device.serial ?? "—", device.holder, `${clockTime(device.takenAt)} (${minutes(device.heldMs)})`]
          : [device.avd, "—", "free", "—"],
      ),
    ),
    "",
    ` ${stacks.length} of ${limits.maxStacks} stacks · ${headroomGB.toFixed(1)} GB above the ${floorGB} GB floor`,
  );

  if (warnings.length > 0) {
    sections.push("", ...warnings.map((warning) => ` warning: ${warning}`));
  }
  return `${sections.join("\n")}\n`;
}

export function renderWorktree(status, worktreePath) {
  const stack = status.stacks.find((candidate) => candidate.worktree === worktreePath);
  if (stack === undefined) {
    return ` ${worktreePath} holds no slot — run \`npm run dev:claim\` to take one.\n`;
  }
  const { urls } = stack;
  return [
    ` ${stack.branch} · slot ${stack.slot}${stack.state === "stale" ? " (stale)" : ""}`,
    "",
    `   web,  this laptop   ${urls.webLocal}`,
    `   web,  phone         ${urls.webLan ?? "unavailable — no LAN address"}`,
    `   app,  phone         ${urls.expoLan ?? "unavailable — no LAN address"}`,
    `   app,  emulator      ${urls.expoEmulator}   (needs adb reverse tcp:${stack.ports.metro})`,
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/devStatusRender.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the CLI entry point**

Create `scripts/dev-status.mjs`:

```js
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
```

- [ ] **Step 6: Register the npm script**

In root `package.json`, add below `"dev:release"`:

```json
    "dev:status": "node scripts/dev-status.mjs",
```

- [ ] **Step 7: Run the CLI end to end**

Run:
```bash
npm run dev:status
npm run dev:status -- --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(Object.keys(o), o.stacks.length)})'
npm run dev:status -- --worktree
```
Expected: the snapshot prints with a host line, a device table and the headroom line; `--json` parses and reports the keys `host, stacks, devices, orphans, limits, warnings`; `--worktree` prints this worktree's URLs, or says it holds no slot. No stack traces on any of the three.

- [ ] **Step 8: Integration check with two stacks up**

In two worktrees, run `npm run dev:claim` and start `npm run backend` in each, then from either:
```bash
npm run dev:status
npm run dev:status -- --json
```
Expected: both worktrees listed, non-overlapping backend/web/Metro ports, each with a plausible non-zero `rssTotalMB`, and `--worktree` from inside each resolves that worktree's own slot. Release both with `npm run dev:release` afterwards.

- [ ] **Step 9: Run the whole script suite and commit**

Run: `npm run test:scripts`
Expected: PASS.

```bash
git add scripts/devStatusRender.mjs scripts/devStatusRender.test.mjs scripts/dev-status.mjs package.json
git commit -m "feat(dev): npm run dev:status prints the slot, device and headroom snapshot"
```

---

### Task 7: The status page

Optional, and deliberately last: a thin renderer over the same `collectStatus()`, so the two surfaces cannot drift. Deferred until the CLI has been lived with — start it only when the CLI has earned it.

**Files:**
- Create: `scripts/devStatusPage.mjs` (pure HTML rendering)
- Create: `scripts/dev-status-server.mjs` (the server)
- Test: `scripts/devStatusPage.test.mjs`
- Modify: `scripts/dev-status.mjs` (add `--serve`)

**Interfaces:**
- Consumes: `collectStatus()` (Tasks 4–5), the `STATUS` shape from Task 6's tests.
- Produces: `renderPage(status) -> string` (a complete self-contained HTML document); `startServer({ repoRoot, port }) -> http.Server`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/devStatusPage.test.mjs`. Reuse the exact `STATUS` fixture object from `scripts/devStatusRender.test.mjs` (copy it in — the two test files are independent):

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPage } from "./devStatusPage.mjs";
import { DEFAULT_LIMITS } from "./devHost.mjs";

const STATUS = {
  host: { lanAddress: "192.168.1.24", totalMemGB: 31.9, freeMemGB: 8.2, freeBytes: 8.2 * 1024 ** 3, loadAvg1: 3.4, cores: 10 },
  limits: DEFAULT_LIMITS,
  orphans: [],
  warnings: ["slot 3 (mobile/y) is stale."],
  stacks: [
    {
      slot: 2,
      worktree: "/wt/4d",
      branch: "mobile/4d-design-system",
      session: "4d-design-system",
      state: "live",
      ports: { backend: 3200, vite: 5373, metro: 8281 },
      processes: [],
      rssTotalMB: 704,
      cpuTotal: 22,
      portAudit: [],
      urls: {
        webLocal: "http://localhost:5373",
        webLan: "http://192.168.1.24:5373",
        expoLan: "exp://192.168.1.24:8281",
        expoEmulator: "exp://127.0.0.1:8281",
      },
    },
  ],
  devices: [
    { avd: "scripta-dev-0", serial: "emulator-5554", holder: "mobile/5a-library", takenAt: "2026-09-14T14:31:00.000Z", heldMs: 18 * 60 * 1000, rssMB: 2048 },
    { avd: "scripta-dev-1", serial: null, holder: null, takenAt: null, heldMs: null, rssMB: null },
  ],
};

test("the page is a complete document with a viewport meta for the phone", () => {
  const html = renderPage(STATUS);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /name="viewport"/);
});

test("each stack card carries tappable web and Expo LAN links", () => {
  const html = renderPage(STATUS);
  assert.match(html, /href="http:\/\/192\.168\.1\.24:5373"/);
  assert.match(html, /href="exp:\/\/192\.168\.1\.24:8281"/);
});

test("the API base is offered as copyable text, not a link", () => {
  assert.match(renderPage(STATUS), /http:\/\/192\.168\.1\.24:3200/);
});

test("branch and session names are escaped, never interpolated raw", () => {
  const hostile = { ...STATUS, stacks: [{ ...STATUS.stacks[0], branch: "<script>alert(1)</script>" }] };
  const html = renderPage(hostile);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("the host bar shows free memory, load and stack count", () => {
  const html = renderPage(STATUS);
  assert.match(html, /8\.2 GB/);
  assert.match(html, /3\.4/);
  assert.match(html, /1 of 4/);
});

test("device rows show holder and duration", () => {
  const html = renderPage(STATUS);
  assert.match(html, /scripta-dev-0/);
  assert.match(html, /mobile\/5a-library/);
  assert.match(html, /18m/);
});

test("zero stacks renders a page rather than an empty body", () => {
  const html = renderPage({ ...STATUS, stacks: [], warnings: [] });
  assert.match(html, /no stacks running/i);
  assert.match(html, /scripta-dev-1/);
});

test("warnings appear on the page", () => {
  assert.match(renderPage(STATUS), /slot 3 \(mobile\/y\) is stale\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devStatusPage.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/devStatusPage.mjs`

- [ ] **Step 3: Write the page renderer**

Create `scripts/devStatusPage.mjs`:

```js
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

function link(href, label) {
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : `<span class="muted">${escapeHtml(label)} unavailable</span>`;
}

function stackCard(stack, hostAddress) {
  return `
    <section class="card${stack.state === "stale" ? " stale" : ""}">
      <h2>${escapeHtml(stack.branch)}</h2>
      <p class="meta">slot ${stack.slot} · ${escapeHtml(stack.session ?? "no session")} · ${stack.rssTotalMB} MB · ${stack.cpuTotal}%${stack.state === "stale" ? " · stale" : ""}</p>
      <ul>
        <li>${link(stack.urls.webLan, "open the web app")}</li>
        <li>${link(stack.urls.expoLan, "open in Expo Go")}</li>
        <li class="api">API <code>http://${escapeHtml(hostAddress)}:${stack.ports.backend}</code></li>
      </ul>
    </section>`;
}

function deviceRow(device) {
  return device.holder
    ? `<tr><td>${escapeHtml(device.avd)}</td><td>${escapeHtml(device.serial ?? "—")}</td><td>${escapeHtml(device.holder)}</td><td>${Math.round(device.heldMs / 60000)}m</td></tr>`
    : `<tr><td>${escapeHtml(device.avd)}</td><td>—</td><td class="muted">free</td><td>—</td></tr>`;
}

export function renderPage(status) {
  const { host, stacks, devices, limits, warnings } = status;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>scripta dev</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; font: 16px/1.5 -apple-system, system-ui, sans-serif; }
  .host { font-size: 14px; opacity: .8; margin-bottom: 16px; }
  .card { border: 1px solid rgba(128,128,128,.4); border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }
  .card.stale { opacity: .55; }
  h2 { font-size: 17px; margin: 0 0 4px; word-break: break-all; }
  .meta { font-size: 13px; opacity: .7; margin: 0 0 8px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 6px 0; }
  a { display: inline-block; padding: 6px 0; }
  code { word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 6px 4px; border-top: 1px solid rgba(128,128,128,.25); }
  .muted { opacity: .6; }
  .warning { font-size: 14px; padding: 8px 0; }
</style>
</head>
<body>
<p class="host">${escapeHtml(host.lanAddress ?? "no LAN address")} · ${host.freeMemGB} GB free of ${host.totalMemGB} GB · load ${host.loadAvg1.toFixed(1)} / ${host.cores} cores · ${stacks.length} of ${limits.maxStacks} stacks</p>
${stacks.length === 0 ? '<p class="muted">no stacks running.</p>' : stacks.map((stack) => stackCard(stack, host.lanAddress ?? "localhost")).join("")}
<table>${devices.map(deviceRow).join("")}</table>
${warnings.map((warning) => `<p class="warning">⚠ ${escapeHtml(warning)}</p>`).join("")}
</body>
</html>
`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/devStatusPage.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the server**

Create `scripts/dev-status-server.mjs`:

```js
// The same collectStatus() the CLI prints, rendered for a phone. Bound to
// 7070 — outside every slot range (backend 3000–4500, Vite 5173–6673,
// Metro 8081–9581), so it can never collide with a worktree's stack. It
// holds no slot and is not part of any worktree's stack: started and
// stopped by hand. Sampled per request; nothing is polled or stored.

import { createServer } from "node:http";
import { collectStatus } from "./devStatus.mjs";
import { renderPage } from "./devStatusPage.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

export const STATUS_PAGE_PORT = 7070;

export function startServer({ repoRoot, port = STATUS_PAGE_PORT } = {}) {
  const server = createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    try {
      const status = collectStatus({ repoRoot });
      const body = request.url === "/status.json" ? JSON.stringify(status, null, 2) : renderPage(status);
      const type = request.url === "/status.json" ? "application/json" : "text/html; charset=utf-8";
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(error?.stack ?? error));
    }
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[dev-status] http://${pickLanAddress() ?? "localhost"}:${port} — Ctrl-C to stop.`);
  });
  return server;
}
```

- [ ] **Step 6: Wire `--serve` into the CLI**

In `scripts/dev-status.mjs`, replace the line `const status = collectStatus({ repoRoot });` and everything after it with:

```js
if (args.includes("--serve")) {
  const { startServer } = await import("./dev-status-server.mjs");
  startServer({ repoRoot });
} else {
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
}
```

- [ ] **Step 7: Serve it and check both routes**

Run:
```bash
npm run dev:status -- --serve &
sleep 1
curl -sS localhost:7070 | head -20
curl -sS localhost:7070/status.json | head -5
kill %1
```
Expected: the HTML page renders (with zero stacks running, it says "no stacks running." and still lists both AVDs), and `/status.json` returns the same object the CLI's `--json` prints. Then open `http://<lan>:7070` on the phone once and bookmark it.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm run test:scripts`
Expected: PASS.

```bash
git add scripts/devStatusPage.mjs scripts/devStatusPage.test.mjs scripts/dev-status-server.mjs scripts/dev-status.mjs
git commit -m "feat(dev): serve the same status snapshot as a LAN page for the phone"
```

---

## Documentation

Fold into the commit for Task 6 (the CLI is the point at which the tool becomes usable):

- Root `AGENTS.md`, the "Dev servers" bullet: add `Run \`npm run dev:status\` to see which worktrees hold slots, which ports they bound and who holds an emulator.`
- `docs/superpowers/specs/2026-09-11-dev-status-design.md`: add a `Status: implemented` line and a pointer to this plan, plus a one-line note that the three amendments above supersede the spec's original wording on `stale`, device serials and the headroom numbers.
