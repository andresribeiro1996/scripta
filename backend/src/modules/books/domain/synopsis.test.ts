import assert from "node:assert/strict";
import { test } from "node:test";
import { isFragment, isHiddenSynopsis, summaryHashOf } from "./synopsis.js";

test("summaryHashOf ignores surrounding and repeated whitespace and is null for blank text", () => {
  assert.equal(summaryHashOf("  A story\n\nabout   a boy. "), summaryHashOf("A story about a boy."));
  assert.notEqual(summaryHashOf("A story about a boy."), summaryHashOf("A story about a girl."));
  assert.match(summaryHashOf("x")!, /^[0-9a-f]{40}$/);
  assert.equal(summaryHashOf(" \n\t "), null);
  assert.equal(summaryHashOf(null), null);
});

test("isFragment counts letters, not characters, and the line is 40", () => {
  assert.equal(isFragment("Text: Portugese"), true);
  assert.equal(isFragment(`${"a".repeat(39)} 1234567890 !!! ??? ...`), true);
  assert.equal(isFragment("a".repeat(40)), false);
  assert.equal(isFragment("é".repeat(40)), false);
});

test("isHiddenSynopsis follows the rule, manual decisions and the Jev line", () => {
  assert.equal(isHiddenSynopsis(undefined), false);
  assert.equal(isHiddenSynopsis({ model: "rule", usable: 0 }), true);
  assert.equal(isHiddenSynopsis({ model: "manual", usable: 0 }), true);
  assert.equal(isHiddenSynopsis({ model: "manual", usable: 1 }), false);
  assert.equal(isHiddenSynopsis({ model: "jev-1.13.0", usable: 0.14 }), true);
  assert.equal(isHiddenSynopsis({ model: "jev-1.13.0", usable: 0.15 }), false);
  assert.equal(isHiddenSynopsis({ model: "jev-1.13.0", usable: 0.23 }), false);
  assert.equal(isHiddenSynopsis({ model: "jev-1.13.0", usable: 0.45 }), false);
});
