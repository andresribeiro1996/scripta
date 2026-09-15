import assert from "node:assert/strict";
import { test } from "node:test";
import { metroNodeOptions, parseAvdNameOutput, pickSerialForAvd, shouldCreateAvd } from "./dev-emulator.mjs";

const TWO_EMULATORS = "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n";

test("pickSerialForAvd returns the serial whose AVD name matches", () => {
  const nameFor = (serial) => (serial === "emulator-5554" ? "scripta-dev-0" : "scripta-dev-1");
  assert.equal(pickSerialForAvd(TWO_EMULATORS, "scripta-dev-1", nameFor), "emulator-5556");
  assert.equal(pickSerialForAvd(TWO_EMULATORS, "scripta-dev-0", nameFor), "emulator-5554");
});

test("pickSerialForAvd returns null when no emulator has that AVD name", () => {
  const nameFor = () => "some-other-avd";
  assert.equal(pickSerialForAvd(TWO_EMULATORS, "scripta-dev-1", nameFor), null);
});

test("pickSerialForAvd ignores emulators not in device state", () => {
  const output =
    "List of devices attached\nemulator-5554\toffline\nemulator-5556\tunauthorized\nemulator-5558\tdevice\n";
  const seen = [];
  const nameFor = (serial) => {
    seen.push(serial);
    return "scripta-dev-1";
  };
  assert.equal(pickSerialForAvd(output, "scripta-dev-1", nameFor), "emulator-5558");
  // Only the device-state serial should ever be asked for its AVD name —
  // offline/unauthorized entries must never even reach the lookup.
  assert.deepEqual(seen, ["emulator-5558"]);
});

test("pickSerialForAvd with no emulators at all returns null", () => {
  assert.equal(pickSerialForAvd("List of devices attached\n", "scripta-dev-0", () => "anything"), null);
});

test("parseAvdNameOutput tolerates the trailing OK line", () => {
  assert.equal(parseAvdNameOutput("scripta-dev-0\nOK\n"), "scripta-dev-0");
});

test("parseAvdNameOutput tolerates surrounding whitespace", () => {
  assert.equal(parseAvdNameOutput("  scripta-dev-0  \nOK\n"), "scripta-dev-0");
});

test("parseAvdNameOutput tolerates leading blank lines", () => {
  assert.equal(parseAvdNameOutput("\n\nscripta-dev-1\nOK\n"), "scripta-dev-1");
});

test("parseAvdNameOutput returns null for blank output", () => {
  assert.equal(parseAvdNameOutput("\n\n"), null);
});

test("shouldCreateAvd creates only when a clean listing omits the AVD", () => {
  const listing = "Available Android Virtual Devices:\n    Name: scripta-dev-0\n";
  assert.equal(shouldCreateAvd({ status: 0, stdout: listing }, "scripta-dev-1"), true);
  assert.equal(shouldCreateAvd({ status: 0, stdout: listing }, "scripta-dev-0"), false);
});

test("a timed-out avdmanager listing never recreates an existing AVD", () => {
  const killed = { status: null, stdout: "", error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }) };
  assert.equal(shouldCreateAvd(killed, "scripta-dev-0"), false);
});

test("a failed avdmanager listing is unknown, not absent", () => {
  assert.equal(shouldCreateAvd({ status: 1, stdout: "" }, "scripta-dev-0"), false);
});

test("metroNodeOptions appends the IPv4-first flag to an empty NODE_OPTIONS", () => {
  assert.equal(metroNodeOptions(undefined), "--dns-result-order=ipv4first");
});

test("metroNodeOptions appends to, not replaces, an existing NODE_OPTIONS", () => {
  assert.equal(metroNodeOptions("--max-old-space-size=4096"), "--max-old-space-size=4096 --dns-result-order=ipv4first");
});

test("metroNodeOptions is idempotent — re-running does not duplicate the flag", () => {
  const once = metroNodeOptions(undefined);
  assert.equal(metroNodeOptions(once), once);
});
