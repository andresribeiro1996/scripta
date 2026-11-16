import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

registerHooks({ load: (url, context, next) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context)) });

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { LibrarySaverContext, createWebLibrarySaver } = await import("../src/hooks/useLibrarySaver.ts");
const { ArenaListPage } = await import("../src/pages/ArenaListPage.tsx");

const rendered = (prepare: (client: QueryClient) => void, entry: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  try {
    prepare(client);
    const page: ReactNode = createElement(ArenaListPage);
    return renderToString(createElement(QueryClientProvider, { client }, createElement(LibrarySaverContext.Provider, { value: createWebLibrarySaver(client) }, createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: [entry] }, page)))))));
  } finally {
    client.clear();
  }
};

const owned = (id: string, name: string) => ({ id, name, voteCode: null, promotedAt: null, votingOpen: false, updatedAt: "2026-10-03T10:00:00.000Z", subject: null, data: { tiers: [], pool: [] } });
const voted = (id: string, name: string) => ({ id, name, voteCode: "abc", covers: [], poolSize: 3, ballotCount: 1, votingOpen: true, viewerVoted: true, promotedAt: null, subject: null });

const prepare = (client: QueryClient) => {
  client.setQueryData(["arenas", "mine"], []);
  client.setQueryData(["arenas", "voted"], []);
  client.setQueryData(["quizzes"], []);
  client.setQueryData(["tierlists"], [owned("o1", "Night Reads"), owned("o2", "Day Reads")]);
  client.setQueryData(["tierlists", "voted"], [voted("v1", "Fantasy"), voted("v2", "Night Fantasy")]);
};

test("the tier-list tab shows a search field and a voted badge", () => {
  const html = rendered(prepare, "/dashboard/arena?tab=tierlists");
  assert.match(html, /aria-label="Search tier lists"/);
  assert.match(html, />Voted</);
  assert.match(html, /Day Reads/);
  assert.match(html, /Fantasy/);
});

test("the quizzes tab shows a search field once there is a quiz", () => {
  const withQuiz = (client: QueryClient) => {
    prepare(client);
    client.setQueryData(["quizzes"], [{ id: "q1", name: "Quiz", voteCode: null, playOpen: false, data: { books: [{}], questionCount: 1, questions: [] } }]);
  };
  assert.match(rendered(withQuiz, "/dashboard/arena?tab=quizzes"), /aria-label="Search quizzes"/);
});
