import assert from "node:assert/strict";
import { test } from "node:test";
import { receiveScans, sendScan } from "./scanBridge.js";

test("a scan reaches the screen listening for it, and nobody once it stops", () => {
  const seen: string[] = [];
  const stop = receiveScans((isbn) => seen.push(isbn));
  sendScan("9780441013593");
  stop();
  sendScan("9780141184272");
  assert.deepEqual(seen, ["9780441013593"]);
});

test("a newer listener replaces the older one, and the older one's stop leaves it alone", () => {
  const first: string[] = [];
  const second: string[] = [];
  const stopFirst = receiveScans((isbn) => first.push(isbn));
  const stopSecond = receiveScans((isbn) => second.push(isbn));
  stopFirst();
  sendScan("9780441013593");
  stopSecond();
  assert.deepEqual(first, []);
  assert.deepEqual(second, ["9780441013593"]);
});
