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
