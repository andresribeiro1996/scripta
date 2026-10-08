import assert from "node:assert/strict";
import { test } from "node:test";
import { displayName, nameParts, roman } from "./numerals.js";

test("roman numerals up to 3999, and Arabic beyond or below", () => {
  assert.deepEqual([1, 4, 9, 14, 42, 48, 140, 2014, 2026, 3999].map(roman), ["I", "IV", "IX", "XIV", "XLII", "XLVIII", "CXL", "MMXIV", "MMXXVI", "MMMCMXCIX"]);
  assert.equal(roman(4000), "4000");
  assert.equal(roman(0), "0");
  assert.equal(roman(2.5), "2.5");
});

test("a username splits into first and last on dots and underscores", () => {
  assert.deepEqual(nameParts("andre.ribeiro"), { first: "andre", last: "ribeiro" });
  assert.deepEqual(nameParts("ana_maria_silva"), { first: "ana", last: "silva" });
  assert.deepEqual(nameParts("a..b"), { first: "a", last: "b" });
});

test("a single-part username has no last name", () => {
  assert.deepEqual(nameParts("andre"), { first: "andre", last: null });
  assert.deepEqual(nameParts("_andre_"), { first: "andre", last: null });
});

test("the display name capitalises each part", () => {
  assert.equal(displayName("andre.ribeiro"), "Andre Ribeiro");
  assert.equal(displayName("scripta_dev"), "Scripta Dev");
  assert.equal(displayName("andre"), "Andre");
});
