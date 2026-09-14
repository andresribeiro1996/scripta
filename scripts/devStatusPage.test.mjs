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
        apiLocal: "http://localhost:3200",
        apiLan: "http://192.168.1.24:3200",
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

test("a held device with an unparseable takenAt renders an em dash, not NaNm", () => {
  const status = {
    ...STATUS,
    devices: [
      { avd: "scripta-dev-2", serial: "emulator-5556", holder: "mobile/9z-broken", takenAt: "not-a-date", heldMs: null, rssMB: 1024 },
    ],
  };
  const html = renderPage(status);
  assert.match(html, /scripta-dev-2/);
  assert.match(html, /mobile\/9z-broken/);
  assert.ok(!html.includes("NaNm"));
  assert.match(html, /<td>—<\/td><\/tr>/);
});
