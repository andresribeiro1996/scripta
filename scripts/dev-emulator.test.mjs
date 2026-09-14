import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAvdNameOutput, pickSerialForAvd } from "./dev-emulator.mjs";

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
