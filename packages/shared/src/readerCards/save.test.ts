import assert from "node:assert/strict";
import { test } from "node:test";
import { saveReaderCardStyle } from "./save.js";
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, type ReaderCardStyle } from "./style.js";

function memory(initial?: ReaderCardStyle) {
  let value = initial;
  const writes: ReaderCardStyle[] = [];
  return { writes, get: () => value, set: (style: ReaderCardStyle) => { value = style; writes.push(style); } };
}

test("a change shows at once and settles on what the server stored", async () => {
  const cache = memory(DEFAULT_READER_CARD_STYLE);
  let release!: (style: ReaderCardStyle) => void;
  const saving = saveReaderCardStyle(cache, { counter: "ring" }, () => new Promise((resolve) => { release = resolve; }));
  assert.equal(cache.get()!.counter, "ring");
  release({ ...DEFAULT_READER_CARD_STYLE, counter: "ring", trait: "seal" });
  await saving;
  assert.equal(cache.get()!.trait, "seal");
});

test("a failed change goes back to what was there and the error reaches the caller", async () => {
  const cache = memory({ ...DEFAULT_READER_CARD_STYLE, counter: "beads" });
  await assert.rejects(saveReaderCardStyle(cache, { counter: "ring" }, async () => { throw new Error("400"); }), /400/);
  assert.equal(cache.get()!.counter, "beads");
});

test("a newer change is never overwritten by an older answer", async () => {
  const cache = memory(DEFAULT_READER_CARD_STYLE);
  let failFirst!: (error: Error) => void;
  let answerFirst!: (style: ReaderCardStyle) => void;
  const first = saveReaderCardStyle(cache, { counter: "ring" }, () => new Promise((_, reject) => { failFirst = reject; }));
  void saveReaderCardStyle(cache, { trait: "none" }, () => new Promise(() => {}));
  failFirst(new Error("boom"));
  await assert.rejects(first);
  assert.equal(cache.get()!.trait, "none");
  const third = saveReaderCardStyle(cache, { layout: "book" }, () => new Promise((resolve) => { answerFirst = resolve; }));
  void saveReaderCardStyle(cache, { layout: "merged" }, () => new Promise(() => {}));
  answerFirst({ ...DEFAULT_READER_CARD_STYLE, layout: "book" });
  await third;
  assert.equal(cache.get()!.layout, "merged");
});

test("an empty cache starts from the default style, and a choice is normalised like the server does", async () => {
  const cache = memory();
  await saveReaderCardStyle(cache, { signature: { bookKey: "k", note: "  lent  " } }, async (patch) => normalizeReaderCardStyle({ ...DEFAULT_READER_CARD_STYLE, ...patch }));
  assert.deepEqual(cache.writes[0]!.signature, { bookKey: "k", note: "lent" });
  assert.equal(cache.writes[0]!.counter, "dial");
});

test("identity does not matter: a cache that hands back copies still rolls back and takes the answer", async () => {
  let value: ReaderCardStyle | undefined = DEFAULT_READER_CARD_STYLE;
  const cache = { get: () => value && structuredClone(value), set: (style: ReaderCardStyle) => { value = style; } };
  await assert.rejects(saveReaderCardStyle(cache, { layout: "book" }, async () => { throw new Error("400"); }), /400/);
  assert.equal(cache.get()!.layout, "faces");
  await saveReaderCardStyle(cache, { layout: "book" }, async () => ({ ...DEFAULT_READER_CARD_STYLE, layout: "book", trait: "seal" }));
  assert.equal(cache.get()!.trait, "seal");
});
