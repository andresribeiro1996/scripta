import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_READER_CARD_STYLE, bookKey, type ReaderCardBase, type ReaderCardStyle } from "@scripta/shared";
import { useReaderCard } from "../src/hooks/useReaderCard";
import { READER_CARD_STYLE_KEY, useSaveReaderCardStyle } from "../src/hooks/useReaderCardStyle";

const books = [{ Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, _coverUrl: "https://covers.example.org/e.jpg" }];
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

test("the owner's card draws the stored style and choice; a visitor's card never reads it", () => {
  const client = queryClient();
  const style: ReaderCardStyle = { ...DEFAULT_READER_CARD_STYLE, counter: "ring", signature: { bookKey: bookKey(books[0]!), note: "lent" } };
  client.setQueryData(READER_CARD_STYLE_KEY, style);
  let owner!: ReaderCardBase;
  let visitor!: ReaderCardBase;
  function Probe() {
    owner = useReaderCard(books, [], "andre");
    visitor = useReaderCard(books, [], "andre", { state: "unwritten", identity: null, runnerUp: null, signal: null, coverage: [] });
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  assert.equal(owner.style.counter, "ring");
  assert.equal(owner.card.chosen?.signature?.coverUrl, "https://covers.example.org/e.jpg");
  assert.equal(owner.card.chosen?.signature?.note, "lent");
  assert.equal(visitor.view, "visitor");
  assert.equal(visitor.style.counter, "dial");
});

test("saving shows the change at once and rolls back when the server refuses", async () => {
  const client = queryClient();
  client.setQueryData(READER_CARD_STYLE_KEY, DEFAULT_READER_CARD_STYLE);
  let save!: ReturnType<typeof useSaveReaderCardStyle>;
  function Probe() { save = useSaveReaderCardStyle(); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const originalFetch = globalThis.fetch;
  let seen: ReaderCardStyle | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.method, "PATCH");
      assert.deepEqual(JSON.parse(String(init.body)), { layout: "book" });
      seen = client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY);
      return Response.json({ error: "Expected a reader card style change with known options." }, { status: 400 });
    };
    await assert.rejects(save({ layout: "book" }));
    assert.equal(seen?.layout, "book");
    assert.equal(client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY)?.layout, "faces");
    assert.equal(client.getQueryState(READER_CARD_STYLE_KEY)?.isInvalidated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
