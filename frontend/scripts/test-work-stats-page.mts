import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BookStats, WorkPage } from "@scripta/shared";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true });

const { AuthProvider } = await import("../src/auth/AuthContext");
const { setSession } = await import("../src/auth/tokenStore");
const { WorkStatsView } = await import("../src/pages/WorkStatsPage");

const page = { work: { id: "w", title: "Dune", rating: null } } as unknown as WorkPage;
const stats: BookStats = { community: null, tiers: null, tournaments: null };
const failed = { status: "error", error: new Error("x"), fetchStatus: "idle" } as const;

function render(client: QueryClient) {
  return renderToString(createElement(QueryClientProvider, { client }, createElement(AuthProvider, null, createElement(MemoryRouter, null, createElement(WorkStatsView, { id: "w" })))));
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

test("the back link is Library when signed in and absent when signed out", () => {
  assert.ok(!render(seeded()).includes("Library"));
  setSession({ user: { id: "u1", email: "a@b.c", username: "alice", avatarId: null }, accessToken: "a", refreshToken: "r" }, false);
  assert.match(render(seeded()), /href="\/dashboard\/library"[^>]*>(?:(?!<\/a>).)*Library<\/a>/s);
  setSession(null);
});
