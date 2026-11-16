import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidUsername } from "./auth.js";

test("isValidUsername checks the trimmed value", () => {
  assert.equal(isValidUsername("ab"), false);
  assert.equal(isValidUsername("abc"), true);
  assert.equal(isValidUsername("a b c"), false);
  assert.equal(isValidUsername("a".repeat(30)), true);
  assert.equal(isValidUsername("a".repeat(31)), false);
  assert.equal(isValidUsername(" abc "), true);
});
