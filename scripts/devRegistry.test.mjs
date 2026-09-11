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
