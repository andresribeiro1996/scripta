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
