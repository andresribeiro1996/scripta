import assert from "node:assert/strict";
import { test } from "node:test";
import { upNextPair } from "./dashboard.js";

test("two keys pairs both, at any offset", () => {
  const keys = ["a", "b"];
  assert.deepEqual(upNextPair(keys, 0), ["a", "b"]);
  assert.deepEqual(upNextPair(keys, 1), ["b", "a"]);
});

test("six keys step through three pairs then wrap to the first", () => {
  const keys = ["k0", "k1", "k2", "k3", "k4", "k5"];
  assert.deepEqual(upNextPair(keys, 0), ["k0", "k1"]);
  assert.deepEqual(upNextPair(keys, 2), ["k2", "k3"]);
  assert.deepEqual(upNextPair(keys, 4), ["k4", "k5"]);
  assert.deepEqual(upNextPair(keys, 6), ["k0", "k1"]);
});

test("an odd count wraps mid-pair", () => {
  const keys = ["k0", "k1", "k2", "k3", "k4"];
  assert.deepEqual(upNextPair(keys, 4), ["k4", "k0"]);
});

test("fewer than two keys yields no pair", () => {
  assert.deepEqual(upNextPair(["only"], 0), []);
  assert.deepEqual(upNextPair([], 0), []);
});
