import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BookStats, WorkPage } from "@scripta/shared";
import { WorkStatsView } from "../src/pages/WorkStatsPage";

const page = { work: { id: "w", title: "Dune", rating: null } } as unknown as WorkPage;
const stats: BookStats = { community: null, tiers: null, tournaments: null };
const failed = { status: "error", error: new Error("x"), fetchStatus: "idle" } as const;

function render(client: QueryClient) {
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(WorkStatsView, { id: "w", back: null }))));
}

function seeded() {
  const client = new QueryClient();
  client.setQueryData(["works", "w"], page);
  client.setQueryData(["works", "w", "stats"], stats);
  return client;
}

test("loaded stats render the sections", () => {
  const html = render(seeded());
  assert.ok(html.includes("Not in any tournament yet."));
  assert.ok(!html.includes("load these stats"));
});

test("a failed background refetch keeps the loaded stats on screen", () => {
  const client = seeded();
  client.getQueryCache().find({ queryKey: ["works", "w", "stats"] })!.setState(failed);
  const html = render(client);
  assert.ok(html.includes("Not in any tournament yet."));
  assert.ok(!html.includes("load these stats"));
});

test("an error with no stats shows Retry", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  client.setQueryData(["works", "w"], page);
  client.getQueryCache().build(client, { queryKey: ["works", "w", "stats"] }).setState(failed);
  const html = render(client);
  assert.ok(html.includes("load these stats"));
  assert.ok(html.includes("Retry"));
});
