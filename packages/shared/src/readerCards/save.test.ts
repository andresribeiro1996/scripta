import assert from "node:assert/strict";
import { test } from "node:test";
import { READER_CARD_STYLE_KEY, saveReaderCardStyle, saveReaderCardStyleIn, type ReaderCardStyleQueries } from "./save.js";
import { DEFAULT_READER_CARD_STYLE, noteSaver, normalizeReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch } from "./style.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

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
  await tick();
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
  let finishSecond!: (style: ReaderCardStyle) => void;
  let answerThird!: (style: ReaderCardStyle) => void;
  let answerFourth!: (style: ReaderCardStyle) => void;
  const first = saveReaderCardStyle(cache, { counter: "ring" }, () => new Promise((_, reject) => { failFirst = reject; }));
  const second = saveReaderCardStyle(cache, { trait: "none" }, () => new Promise((resolve) => { finishSecond = resolve; }));
  await tick();
  failFirst(new Error("boom"));
  await assert.rejects(first);
  assert.equal(cache.get()!.trait, "none");
  await tick();
  const third = saveReaderCardStyle(cache, { layout: "book" }, () => new Promise((resolve) => { answerThird = resolve; }));
  const fourth = saveReaderCardStyle(cache, { layout: "merged" }, () => new Promise((resolve) => { answerFourth = resolve; }));
  finishSecond({ ...DEFAULT_READER_CARD_STYLE, trait: "none" });
  await second;
  await tick();
  answerThird({ ...DEFAULT_READER_CARD_STYLE, layout: "book" });
  await third;
  assert.equal(cache.get()!.layout, "merged");
  await tick();
  answerFourth({ ...DEFAULT_READER_CARD_STYLE, layout: "merged" });
  await fourth;
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

test("only the newest refused save asks the cache to refresh", async () => {
  let refreshed = 0;
  const base = memory(DEFAULT_READER_CARD_STYLE);
  const cache = { ...base, refresh: () => { refreshed += 1; } };
  let failFirst!: (error: Error) => void;
  let failSecond!: (error: Error) => void;
  const first = saveReaderCardStyle(cache, { counter: "ring" }, () => new Promise((_, reject) => { failFirst = reject; }));
  const second = saveReaderCardStyle(cache, { trait: "none" }, () => new Promise((_, reject) => { failSecond = reject; }));
  await tick();
  failFirst(new Error("a"));
  await assert.rejects(first);
  assert.equal(refreshed, 0);
  await tick();
  failSecond(new Error("b"));
  await assert.rejects(second);
  assert.equal(refreshed, 1);
});

test("a second save is sent only after the first has settled, and the patches go out in call order", async () => {
  const withSignature = { ...DEFAULT_READER_CARD_STYLE, signature: { bookKey: "k", note: null } };
  const cache = memory(withSignature);
  const sent: ReaderCardStylePatch[] = [];
  let answerFirst!: (style: ReaderCardStyle) => void;
  const first = saveReaderCardStyle(cache, { signature: { bookKey: "k", note: "lent" } }, (patch) => { sent.push(patch); return new Promise((resolve) => { answerFirst = resolve; }); });
  const second = saveReaderCardStyle(cache, { signature: null }, async (patch) => { sent.push(patch); return DEFAULT_READER_CARD_STYLE; });
  assert.equal(cache.get()!.signature, null);
  await tick();
  assert.deepEqual(sent, [{ signature: { bookKey: "k", note: "lent" } }]);
  answerFirst({ ...withSignature, signature: { bookKey: "k", note: "lent" } });
  await first;
  await second;
  assert.deepEqual(sent, [{ signature: { bookKey: "k", note: "lent" } }, { signature: null }]);
  assert.equal(cache.get()!.signature, null);
});

test("a refused save does not hold back the next one", async () => {
  const cache = memory(DEFAULT_READER_CARD_STYLE);
  const first = saveReaderCardStyle(cache, { counter: "ring" }, async () => { throw new Error("400"); });
  const second = saveReaderCardStyle(cache, { trait: "none" }, async () => ({ ...DEFAULT_READER_CARD_STYLE, trait: "none" }));
  await assert.rejects(first, /400/);
  await second;
  assert.equal(cache.get()!.trait, "none");
});

test("a removal sent right after a note save cannot be undone by that note reaching the server late", async () => {
  const withSignature = { ...DEFAULT_READER_CARD_STYLE, signature: { bookKey: "k", note: null } };
  const cache = memory(withSignature);
  const sent: ReaderCardStylePatch[] = [];
  let server = withSignature;
  let answerNote!: () => void;
  const update = (patch: ReaderCardStylePatch) => {
    sent.push(patch);
    return new Promise<ReaderCardStyle>((resolve) => {
      const done = () => { server = normalizeReaderCardStyle({ ...server, ...patch }); resolve(server); };
      if (patch.signature) answerNote = done;
      else done();
    });
  };
  const saved: Promise<void>[] = [];
  const change = (patch: ReaderCardStylePatch) => { const request = saveReaderCardStyle(cache, patch, update); saved.push(request); return request.then(() => true); };
  noteSaver({ bookKey: "k", note: null }, change, () => {})("lent");
  void change({ signature: null });
  await tick();
  assert.equal(sent.length, 1);
  answerNote();
  await Promise.all(saved);
  assert.deepEqual(sent, [{ signature: { bookKey: "k", note: "lent" } }, { signature: null }]);
  assert.equal(server.signature, null);
  assert.equal(cache.get()!.signature, null);
});

function fakeQueries() {
  const calls: string[] = [];
  let data: ReaderCardStyle | undefined = DEFAULT_READER_CARD_STYLE;
  const queries: ReaderCardStyleQueries = {
    cancelQueries: ({ queryKey }) => { calls.push(`cancel ${queryKey.join("/")}`); },
    getQueryData: (queryKey) => { calls.push(`get ${queryKey.join("/")}`); return data; },
    setQueryData: (queryKey, next) => { calls.push(`set ${queryKey.join("/")} ${next.counter}`); data = next; },
    invalidateQueries: ({ queryKey }) => { calls.push(`invalidate ${queryKey.join("/")}`); },
  };
  return { calls, queries };
}

test("the in-flight style query is cancelled before the optimistic value is written, all under one key", async () => {
  const { calls, queries } = fakeQueries();
  const key = READER_CARD_STYLE_KEY.join("/");
  await saveReaderCardStyleIn(queries, { counter: "ring" }, async () => ({ ...DEFAULT_READER_CARD_STYLE, counter: "ring" }));
  assert.deepEqual(calls, [`cancel ${key}`, `get ${key}`, `set ${key} ring`, `set ${key} ring`]);
});

test("a refused newest save puts the old value back and invalidates the style query", async () => {
  const { calls, queries } = fakeQueries();
  const key = READER_CARD_STYLE_KEY.join("/");
  await assert.rejects(saveReaderCardStyleIn(queries, { counter: "ring" }, async () => { throw new Error("400"); }), /400/);
  assert.deepEqual(calls.slice(-2), [`set ${key} dial`, `invalidate ${key}`]);
});
