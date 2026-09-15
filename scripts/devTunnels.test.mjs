import assert from "node:assert/strict";
import { test } from "node:test";
import { missingTunnels, parseReverseList, TUNNELLED_ROLES } from "./devTunnels.mjs";

// `adb -s <serial> reverse --list` prints one mapping per line. The
// device-side and host-side ports are always equal here, because
// dev-emulator.mjs only ever maps tcp:N to the same tcp:N — so a port
// appearing anywhere on a line means that tunnel is up.
const LIST = ["host-9 tcp:8081 tcp:8081", "host-9 tcp:3000 tcp:3000", ""].join("\n");

test("parseReverseList returns the ports that currently have a tunnel", () => {
  assert.deepEqual(parseReverseList(LIST).sort((a, b) => a - b), [3000, 8081]);
});

test("parseReverseList reports a port once, not once per side of the mapping", () => {
  assert.deepEqual(parseReverseList("host-9 tcp:8281 tcp:8281"), [8281]);
});

test("parseReverseList on empty output is an empty list, not a throw", () => {
  assert.deepEqual(parseReverseList(""), []);
});

test("parseReverseList ignores a line with no tcp mapping", () => {
  assert.deepEqual(parseReverseList("adb: no devices/emulators found"), []);
});

test("only backend and Metro are tunnelled — the browser reaches vite directly", () => {
  assert.deepEqual(TUNNELLED_ROLES, ["backend", "metro"]);
});

test("missingTunnels reports nothing when both tunnels are up", () => {
  const ports = { backend: 3000, vite: 5173, metro: 8081 };
  assert.deepEqual(missingTunnels(ports, [3000, 8081]), []);
});

test("missingTunnels names the role and port of each absent tunnel", () => {
  const ports = { backend: 3200, vite: 5373, metro: 8281 };
  assert.deepEqual(missingTunnels(ports, [3200]), [["metro", 8281]]);
});

test("missingTunnels reports both when the device has no tunnels at all", () => {
  const ports = { backend: 3200, vite: 5373, metro: 8281 };
  assert.deepEqual(missingTunnels(ports, []), [
    ["backend", 3200],
    ["metro", 8281],
  ]);
});

// The vite port is never tunnelled, so its absence must never be reported
// as missing — that would be a warning nobody can act on.
test("missingTunnels never reports the vite port", () => {
  const ports = { backend: 3200, vite: 5373, metro: 8281 };
  const missing = missingTunnels(ports, [3200, 8281]);
  assert.deepEqual(missing, []);
  assert.ok(!missingTunnels(ports, []).some(([, port]) => port === ports.vite));
});
