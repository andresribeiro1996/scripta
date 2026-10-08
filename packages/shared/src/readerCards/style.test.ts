import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_READER_CARD_STYLE, noteSaver, noteToSend, normalizeReaderCardStyle, publicStyle, rekeyReaderCardStyle, type ReaderCardStylePatch } from "./style.js";

test("the default style chooses no book and no highlight", () => {
  assert.deepEqual(DEFAULT_READER_CARD_STYLE, { counter: "dial", layout: "faces", trait: "both", signature: null, highlight: null });
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
  assert.deepEqual(publicStyle(style), { counter: "ring", layout: "faces", trait: "both" });
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

test("a layout is kept when known and falls back to faces otherwise", () => {
  assert.equal(normalizeReaderCardStyle({ layout: "book" }).layout, "book");
  assert.equal(normalizeReaderCardStyle({ layout: "scroll" }).layout, "faces");
  assert.deepEqual(publicStyle(normalizeReaderCardStyle({ layout: "merged", signature: { bookKey: "k" } })), { counter: "dial", layout: "merged", trait: "both" });
});

test("a note is sent trimmed, cleared as null, and never twice in a row", () => {
  assert.equal(noteToSend("  lent twice ", null), "lent twice");
  assert.equal(noteToSend("   ", "lent twice"), null);
  assert.equal(noteToSend("lent twice", "lent twice"), undefined);
  assert.equal(noteToSend("", null), undefined);
});

test("the note saver sends nothing for an unchanged note, null for whitespace, and the book key every time", () => {
  const patches: ReaderCardStylePatch[] = [];
  const change = async (patch: ReaderCardStylePatch) => { patches.push(patch); return true; };
  const save = noteSaver({ bookKey: "k", note: "lent" }, () => {});
  save("lent", change);
  save("  fresh ", change);
  save("fresh", change);
  save("   ", change);
  assert.deepEqual(patches, [{ signature: { bookKey: "k", note: "fresh" } }, { signature: { bookKey: "k", note: null } }]);
});

test("a refused note rolls the draft back only while it is unchanged, and the same text can be sent again", async () => {
  let draft = "lent";
  const results = [false, false];
  const patches: ReaderCardStylePatch[] = [];
  const change = async (patch: ReaderCardStylePatch) => { patches.push(patch); return results.shift()!; };
  const save = noteSaver({ bookKey: "k", note: null }, (failed, previous) => {
    if (draft === failed) draft = previous ?? "";
  });
  save("lent", change);
  draft = "lent twice";
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(draft, "lent twice");
  draft = "lent";
  save("lent", change);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(patches.length, 2);
  assert.equal(draft, "");
});
