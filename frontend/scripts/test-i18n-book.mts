import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bookStatsModel, type DashboardFeedPage, type DigestItem, type WorkPage } from "@scripta/shared";
import type { ActivityEngagement } from "@scripta/shared/community";

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

const { setLocalePreference } = await import("../src/i18n/index.ts");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { BookScreen } = await import("../src/components/book/BookScreen.tsx");
const { StatsSections } = await import("../src/components/book/BookStats.tsx");
const { RatingStars } = await import("../src/components/book/RatingStars.tsx");
const { DailyChapterInvitation } = await import("../src/components/dailyChapter/DailyChapterCard.tsx");
const { CommentsSheet } = await import("../src/components/home/CommentsSheet.tsx");
const { FeedCard } = await import("../src/components/home/FeedCard.tsx");
const { ForYouPanel } = await import("../src/components/home/ForYouPanel.tsx");
const { ReadingStrip } = await import("../src/components/home/ReadingStrip.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { createWebLibrarySaver, LibrarySaverContext } = await import("../src/hooks/useLibrarySaver.ts");
const { homeGames } = await import("../src/lib/homeGames.ts");
const { HomePage } = await import("../src/pages/HomePage.tsx");
const { WorkStatsView } = await import("../src/pages/WorkStatsPage.tsx");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};

const withClient = (prepare: (client: QueryClient) => void, element: () => ReactNode, render: (node: ReactNode) => string = renderToString) => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  try {
    prepare(client);
    return render(createElement(QueryClientProvider, { client }, createElement(LibrarySaverContext.Provider, { value: createWebLibrarySaver(client) }, createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(AuthProvider, null, createElement(MemoryRouter, null, element())))))));
  } finally {
    client.clear();
  }
};
const rendered = (element: () => ReactNode, prepare: (client: QueryClient) => void = () => undefined) => withClient(prepare, element);

const actor = { userId: "u1", username: "alice", avatarUrl: null };
const createdAt = "2026-10-14T10:00:00.000Z";
const finishedReading: DigestItem = { kind: "reading", id: "r1", actor, book: { title: "Piranesi", author: "Susanna Clarke", coverUrl: null, workId: "w1" }, finished: true, createdAt };
const edition = { bookId: "e1", title: "Dune", language: "en", year: 1965, isbn: "9780441013593", coverUrl: null, coverColor: null, pages: 412, mine: false };
const page: WorkPage = {
  work: { id: "w", title: "Dune", author: "Frank Herbert", summary: "Spice and sand.", coverUrl: null, coverColor: null, editions: [edition], genres: ["Science Fiction"], rating: { value: 4.27, count: 2310 }, year: 1965, pages: 412 },
  mine: null,
  readers: { followed: [], others: [], counts: { readers: 0, finished: 0 } },
  games: { tierlists: [], arenas: [], quizzes: [] }
};

test("a book page in Portuguese: author line, add button, rating and genre", () => {
  const screen = () => createElement(BookScreen, { page, book: null, signedIn: true, editionId: null, onSelectEdition: () => undefined, onAdd: () => undefined, onShare: () => undefined, frame: (body: ReactNode) => body });
  assert.match(rendered(screen), />by Frank Herbert</);
  const html = inPortuguese(() => rendered(screen));
  assert.match(html, />de Frank Herbert</);
  assert.match(html, />Adicionar à biblioteca</);
  assert.match(html, /aria-label="Partilhar"/);
  assert.match(html, /Ficção científica/);
  assert.match(html, /Classificação de 4,3 em 5/);
  assert.doesNotMatch(html, /Add to library|by Frank/);
});

test("star ratings read their decimal in Portuguese", () => {
  assert.match(renderToStaticMarkup(createElement(RatingStars, { value: 4.27, label: "x" })), /aria-label="Rated 4.3 out of 5"/);
  assert.match(inPortuguese(() => renderToStaticMarkup(createElement(RatingStars, { value: 4.27, label: "x" }))), /aria-label="Classificação de 4,3 em 5"/);
});

test("the stats sections translate their headings and empty states", () => {
  const model = () => bookStatsModel({ community: null, tiers: null, tournaments: null }, null, "pt-PT");
  const html = inPortuguese(() => renderToStaticMarkup(createElement(StatsSections, { model: model() })));
  assert.match(html, />Classificações</);
  assert.match(html, />Tabelas de níveis</);
  assert.match(html, />Torneios</);
  assert.doesNotMatch(html, /Ratings|Tournaments/);
});

test("a feed card translates its actions", () => {
  const actions = { engagement: { r1: { likes: 2, comments: 1, liked: false } as ActivityEngagement }, saved: new Set<string>(), savedReady: true, busy: { like: false, save: false }, wanting: null, loadError: null, retryLoad: () => undefined, like: () => undefined, save: () => undefined, wantToRead: () => undefined, share: () => undefined };
  const card = () => createElement(FeedCard, { item: finishedReading, actions, books: [], works: undefined });
  assert.match(renderToString(createElement(MemoryRouter, null, card())), />Want to read</);
  const html = inPortuguese(() => renderToString(createElement(MemoryRouter, null, card())));
  assert.match(html, />Quero ler</);
  assert.match(html, /aria-label="Gosto, 2 gostos"/);
  assert.match(html, /aria-label="Comentários, 1"/);
  assert.match(html, /aria-label="Partilhar Piranesi"/);
  assert.doesNotMatch(html, /Want to read|Like,/);
});

test("the For you panel and the comments sheet speak Portuguese", () => {
  const empty: DashboardFeedPage = { items: [], nextCursor: null, seenAt: "2026-10-01T00:00:00.000Z", personalNewCount: 0, followingNewCount: 0 };
  const panel = inPortuguese(() => rendered(() => createElement(ForYouPanel), (client) => client.setQueryData(["community", "dashboard", "activity"], { pages: [empty], pageParams: [undefined] })));
  assert.match(panel, />Para si</);
  assert.match(panel, /Nada de novo por agora/);
  const sheet = inPortuguese(() => rendered(() => createElement(CommentsSheet, { id: "c1", title: "Piranesi", onClose: () => undefined }), (client) => client.setQueryData(["community", "comments", "c1"], { pages: [{ items: [], nextCursor: null }], pageParams: [undefined] })));
  assert.match(sheet, /Comentários/);
  assert.match(sheet, /Seja a primeira pessoa a comentar\./);
  assert.match(sheet, /placeholder="Escreva um comentário…"/);
});

test("the reading strip says nothing is in progress in Portuguese", () => {
  const html = inPortuguese(() => rendered(() => createElement(ReadingStrip, { books: [], works: undefined })));
  assert.match(html, /A sua leitura/);
  assert.match(html, /Nada em curso\./);
  assert.match(html, />Escolha algo da sua biblioteca</);
});

test("the Daily Chapter invitation uses the Portuguese name and meta line", () => {
  const board = { date: "2026-10-31", title: "Spooky shelves", intro: "Ghosts.", theme: { motif: "moon" } } as never;
  const html = inPortuguese(() => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DailyChapterInvitation, { board }))));
  assert.match(html, /O Capítulo do Dia · 31 out 2026/);
  assert.match(html, /5 perguntas · Cerca de 2 minutos · Todos são bem-vindos/);
});

test("Home games name their groups in Portuguese", () => {
  const labels = inPortuguese(() => [homeGames({ circle: [], popular: [], newest: [], viewerId: "me" }).othersLabel]);
  assert.deepEqual(labels, ["Novos jogos"]);
});

test("the Home page renders its loading states in Portuguese", () => {
  const html = inPortuguese(() => rendered(() => createElement(HomePage)));
  assert.match(html, />Início</);
  assert.match(html, />Jogos</);
  assert.match(html, /Ver tudo →/);
  assert.match(html, /A carregar jogos…/);
  assert.match(html, /A carregar a sua leitura…/);
  assert.match(html, /O seu círculo de leitura/);
  assert.doesNotMatch(html, /Browse all|Loading games/);
});

test("the stats page failure says so in Portuguese", () => {
  const work = { work: { id: "w", title: "Dune", rating: null } } as unknown as WorkPage;
  const html = inPortuguese(() => rendered(() => createElement(WorkStatsView, { id: "w" }), (client) => {
    client.setQueryData(["works", "w"], work);
    client.getQueryCache().build(client, { queryKey: ["works", "w", "stats"] }).setState({ status: "error", error: new Error("x"), fetchStatus: "idle" } as never);
  }));
  assert.match(html, /Não foi possível carregar estas estatísticas\./);
  assert.match(html, />Tentar novamente</);
});
