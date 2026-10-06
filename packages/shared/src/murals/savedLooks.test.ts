import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BLOCK_STYLE, resolveBlockStyle } from "../library/libraryStyle.js";
import { readSavedBlockLooks, saveBlockLook, savedBlockLooksKey } from "./savedLooks.js";

test("named looks preserve gradients, effects and theme references after storage", () => {
  const style = resolveBlockStyle({ backgroundColor: "theme:surface", gradientColor: "theme:accent", gradientStrength: 50, shadowColor: "#abc", shadowOpacity: 40, fadeColor: "#fff", cardOpacity: 72 });
  const saved = saveBlockLook([], "  Reading corner  ", style);
  assert.deepEqual(readSavedBlockLooks(JSON.stringify(saved)), [{ name: "Reading corner", style }]);
  assert.notEqual(saved[0].style, style);
  assert.notEqual(saved[0].style.cardBorderSides, style.cardBorderSides);
  assert.notEqual(savedBlockLooksKey("alice"), savedBlockLooksKey("bob"));
});

test("the same name replaces a look without changing the original list", () => {
  const original = saveBlockLook([], "Ink", DEFAULT_BLOCK_STYLE);
  const next = saveBlockLook(original, "ink", resolveBlockStyle({ gradientColor: "#000" }));
  assert.equal(next.length, 1);
  assert.equal(next[0].name, "ink");
  assert.equal(next[0].style.gradientColor, "#000");
  assert.equal(original[0].style.gradientColor, null);
  assert.throws(() => saveBlockLook(next, "  ", DEFAULT_BLOCK_STYLE));
  assert.throws(() => saveBlockLook(next, "x".repeat(49), DEFAULT_BLOCK_STYLE));
});

test("missing storage is empty; malformed storage fails instead of being overwritten", () => {
  assert.deepEqual(readSavedBlockLooks(null), []);
  for (const raw of ["invalid JSON", "{}", "[null]", '[{"name":" ","style":{}}]', '[{"name":"Ink","style":{"cardRadius":"large"}}]', '[{"name":"Ink","style":{"cardBorderSides":null}}]', '[{"name":"Ink","style":{"cardBorderSides":{"top":true}}}]']) assert.throws(() => readSavedBlockLooks(raw));
  assert.deepEqual(readSavedBlockLooks('[{"name":"Old look","style":{"cardRadius":4}}]')[0].style, resolveBlockStyle({ cardRadius: 4 }));
});
