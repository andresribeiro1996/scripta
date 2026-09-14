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
  assert.match(header, /^ A {4}BBBB$/);
  assert.match(row, /^ aaa {2}b {3}$/);
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

test("renderStatus prints headroom as below the floor when free memory is under it", () => {
  const belowFloor = { ...STATUS, host: { ...STATUS.host, freeBytes: 2.7 * 1024 ** 3 } };
  assert.match(renderStatus(belowFloor), /1 of 4 stacks · 1\.3 GB below the 4 GB floor/);
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
