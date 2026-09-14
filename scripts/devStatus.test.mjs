import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPorts, buildStacks, collectStatus, connectionUrls, slotState, statusWarnings } from "./devStatus.mjs";
import { portsForSlot } from "./devRegistry.mjs";
import { DEFAULT_LIMITS } from "./devHost.mjs";

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

test("a stack's process set is the union of disjoint roots, each pid counted once", () => {
  const registry = { ...REGISTRY, slots: { 2: { ...REGISTRY.slots[2], pid: 500 } } };
  const rows = [
    { pid: 500, ppid: 1, rss: 102_400, cpu: 1, comm: "/usr/local/bin/node" },
    { pid: 700, ppid: 1, rss: 204_800, cpu: 2, comm: "/usr/local/bin/node" },
    { pid: 701, ppid: 700, rss: 51_200, cpu: 3, comm: "/usr/local/bin/node" },
    { pid: 702, ppid: 701, rss: 10_240, cpu: 0.5, comm: "/usr/local/bin/node" },
  ];
  const ports = portsForSlot(2);
  const [stack] = buildStacks({
    registry,
    rows,
    listeners: { [ports.backend]: [700], [ports.metro]: [701] },
    lanAddress: "192.168.1.24",
    cwdForPid: () => "/wt/4d",
  });
  const pids = stack.processes.map((p) => p.pid).sort((a, b) => a - b);
  assert.deepEqual(pids, [500, 700, 701, 702]);
  assert.equal(new Set(pids).size, pids.length);
  assert.equal(stack.rssTotalMB, 360);
  assert.equal(stack.cpuTotal, 6.5);
});

test("auditPorts treats a sibling directory with a matching prefix as foreign", () => {
  const audit = auditPorts({
    ports: PORTS,
    listeners: { [PORTS.backend]: [11] },
    worktree: "/wt/mine",
    cwdForPid: () => "/wt/mine-other",
  });
  assert.deepEqual(audit.find((a) => a.role === "backend").foreignPids, [{ pid: 11, cwd: "/wt/mine-other" }]);
});

test("collectStatus joins every injected source with no default evaluated", () => {
  const registry = {
    version: 1,
    slots: {
      3: {
        worktree: "/wt/x",
        branch: "test/branch",
        pid: 12_345,
        session: "sess",
        claimedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    devices: { "scripta-dev-0": null, "scripta-dev-1": null },
  };
  const status = collectStatus({
    registry,
    rows: [],
    listeners: {},
    serials: [],
    hostReading: { freeBytes: 5_000_000_000, loadAvg1: 1.234 },
    lanAddress: "10.0.0.5",
    limits: DEFAULT_LIMITS,
    cwdForPid: () => undefined,
    now: 1_700_000_000_000,
  });
  assert.deepEqual(Object.keys(status).sort(), ["devices", "host", "limits", "orphans", "stacks", "warnings"].sort());
  assert.equal(status.host.freeBytes, 5_000_000_000);
  assert.equal(status.host.freeMemGB, Number((5_000_000_000 / 1024 ** 3).toFixed(1)));
  assert.equal(status.host.loadAvg1, 1.23);
  assert.equal(status.warnings.length, 1);
  assert.match(status.warnings[0], /stale/);
  assert.ok(Array.isArray(status.devices));
  const stack = status.stacks.find((s) => s.slot === 3);
  assert.equal(stack.branch, "test/branch");
});

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
