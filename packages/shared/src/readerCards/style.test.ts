import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, publicStyle, rekeyReaderCardStyle } from "./style.js";

test("the default style chooses no book and no highlight", () => {
  assert.deepEqual(DEFAULT_READER_CARD_STYLE, { counter: "dial", trait: "both", signature: null, highlight: null });
});

test("a signature needs a book key; its note is trimmed, capped at 60 and empty means none", () => {
  assert.equal(normalizeReaderCardStyle({ signature: { note: "x" } }).signature, null);
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "  why  " } }).signature, { bookKey: "k", note: "why" });
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "   " } }).signature, { bookKey: "k", note: null });
  assert.equal(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "a".repeat(80) } }).signature?.note?.length, 60);
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: 5 } }).signature, { bookKey: "k", note: null });
  assert.equal(normalizeReaderCardStyle({ signature: "k" }).signature, null);
});

test("a highlight needs both its book key and its id", () => {
  assert.equal(normalizeReaderCardStyle({ highlight: { bookKey: "k" } }).highlight, null);
  assert.deepEqual(normalizeReaderCardStyle({ highlight: { bookKey: "k", highlightId: "h" } }).highlight, { bookKey: "k", highlightId: "h" });
  assert.equal(normalizeReaderCardStyle({ highlight: ["h"] }).highlight, null);
});

test("the public style drops the private references", () => {
  const style = normalizeReaderCardStyle({ counter: "ring", signature: { bookKey: "k" }, highlight: { bookKey: "k", highlightId: "h" } });
  assert.deepEqual(publicStyle(style), { counter: "ring", trait: "both" });
});

test("rekeying moves choices on merged books and leaves the rest", () => {
  const style = normalizeReaderCardStyle({ signature: { bookKey: "old" }, highlight: { bookKey: "other", highlightId: "h" } });
  const next = rekeyReaderCardStyle(style, ["old"], "kept");
  assert.equal(next.signature?.bookKey, "kept");
  assert.equal(next.highlight?.bookKey, "other");
  assert.equal(rekeyReaderCardStyle(DEFAULT_READER_CARD_STYLE, ["old"], "kept").signature, null);
});

test("rekeying keeps the same choice objects when no merged book is chosen", () => {
  const style = normalizeReaderCardStyle({ signature: { bookKey: "a" }, highlight: { bookKey: "b", highlightId: "h" } });
  const next = rekeyReaderCardStyle(style, ["old"], "kept");
  assert.equal(next.signature, style.signature);
  assert.equal(next.highlight, style.highlight);
});
