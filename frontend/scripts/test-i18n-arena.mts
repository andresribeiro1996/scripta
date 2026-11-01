import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Duel, TournamentView } from "@scripta/shared";

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
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { LibrarySaverContext, createWebLibrarySaver } = await import("../src/hooks/useLibrarySaver.ts");
const { getVoterToken } = await import("../src/lib/arenaVoter.ts");
const { hasTournamentName, UNTITLED_TOURNAMENT } = await import("../src/lib/arenaSeed.ts");
const { TournamentStatusBadge } = await import("../src/components/arena/TournamentStatusBadge.tsx");
const { BracketMap } = await import("../src/components/arena/BracketMap.tsx");
const { CharacterHeader } = await import("../src/components/CharacterHeader.tsx");
const { DiscoverTicket } = await import("../src/components/games/DiscoverTicket.tsx");
const { GameTicket } = await import("../src/components/games/GameTicket.tsx");
const { SeedSlotGrid } = await import("../src/components/arena/SeedSlotGrid.tsx");
const { ArenaListPage } = await import("../src/pages/ArenaListPage.tsx");
const { ArenaSeedPage } = await import("../src/pages/ArenaSeedPage.tsx");
const { ArenaViewPage } = await import("../src/pages/ArenaViewPage.tsx");
const { CharacterGamePage } = await import("../src/pages/CharacterGamePage.tsx");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};

const rendered = (element: () => ReactNode, prepare: (client: QueryClient) => void = () => undefined, entry = "/") => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  try {
    prepare(client);
    return renderToString(createElement(QueryClientProvider, { client }, createElement(LibrarySaverContext.Provider, { value: createWebLibrarySaver(client) }, createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: [entry] }, element())))))));
  } finally {
    client.clear();
  }
};

const side = (title: string, votes: number) => ({ workId: `w-${title}`, title, author: "Author", cover: null, votes });
const duel = (index: number, a: string, b: string, over: Partial<Duel> = {}): Duel => ({
  id: `d${index}`, roundNumber: 1, duelIndex: index, bookA: side(a, 3), bookB: side(b, 1), winnerWorkId: null, status: "active",
  opensAt: "2026-10-01T10:00:00.000Z", closesAt: "2999-01-01T00:00:00.000Z", hasVoted: false, ...over
});
const tournament = (over: Partial<TournamentView> = {}): TournamentView => ({
  id: "t1", name: "Spring finals", bracketSize: 4, roundDurationMinutes: 60, status: "active", currentRound: 1, createdAt: "2026-10-03T10:00:00.000Z",
  ownerUserId: "someone", covers: [], filledSlots: 4, winner: null, subject: null, slots: [], duels: [duel(0, "Dune", "Emma"), duel(1, "Ulysses", "Beloved")], ...over
});
const characterSubject = { kind: "characters" as const, scope: { kind: "work" as const, label: "Dune", coverUrl: null }, characters: [{ id: "c1", name: "Paul" }] };

test("the tournament page builds its bracket subtitle as one Portuguese message", () => {
  const page = () => createElement(Routes, null, createElement(Route, { path: "/arena/:id", element: createElement(ArenaViewPage) }));
  const prepare = (view: TournamentView) => (client: QueryClient) => client.setQueryData(["arena", "t1", getVoterToken()], view);
  assert.match(rendered(page, prepare(tournament()), "/arena/t1"), /4-book bracket/);
  const html = inPortuguese(() => rendered(page, prepare(tournament()), "/arena/t1"));
  assert.match(html, /Chave de 4 livros/);
  assert.match(html, />duelos</);
  assert.match(html, />Jogos</);
  assert.match(html, /Duelo 1/);
  assert.match(html, /2 votos|1 voto/);
  assert.doesNotMatch(html, /bracket|Duel /);
  const characters = inPortuguese(() => rendered(page, prepare(tournament({ subject: characterSubject })), "/arena/t1"));
  assert.match(characters, /Chave de 4 personagens/);
  assert.match(characters, /aria-label="Personagens de Dune"/);
  assert.match(characters, />Personagens · Dune</);
});

test("a missing tournament says so in Portuguese", () => {
  const page = () => createElement(Routes, null, createElement(Route, { path: "/arena/:id", element: createElement(ArenaViewPage) }));
  const html = inPortuguese(() => rendered(page, () => undefined, "/arena/t1"));
  assert.match(html, />Torneio</);
});

test("status badges and the character header translate", () => {
  const badge = (status: "seeding" | "active" | "completed", round?: number) => inPortuguese(() => renderToString(createElement(TournamentStatusBadge, { status, round })));
  assert.match(badge("seeding"), />Em preparação</);
  assert.match(badge("active", 3), />Ronda 3</);
  assert.match(badge("active"), />Ativo</);
  assert.match(badge("completed"), />Concluído</);
  assert.match(renderToString(createElement(TournamentStatusBadge, { status: "active", round: 3 })), />Round 3</);
  assert.match(inPortuguese(() => renderToString(createElement(CharacterHeader, { subject: characterSubject }))), /aria-label="Personagens de Dune"/);
});

test("the bracket map labels each match in Portuguese", () => {
  const withFinal = tournament({ duels: [...tournament().duels, duel(0, "Dune", "Ulysses", { roundNumber: 2, status: "settled", winnerWorkId: "w-Dune" })] });
  const html = inPortuguese(() => renderToString(createElement(MemoryRouter, null, createElement(BracketMap, { tournament: withFinal }))));
  assert.match(html, /aria-label="Dune contra Emma, 75% contra 25%, ainda não votou"/);
  assert.match(html, />Final</);
  assert.match(html, />Meias-finais</);
});

test("game tickets translate their prefix, action and the Voted badge", () => {
  const ticket = () => createElement(MemoryRouter, null, createElement(GameTicket, { kind: "tierlist", name: "Night Reads", to: "/arena/x", meta: "meta", badges: null, covers: [], play: { to: "/vote/x", label: "Votar" } }));
  assert.match(renderToString(ticket()), /aria-label="Open game: Night Reads"/);
  const html = inPortuguese(() => renderToString(ticket()));
  assert.match(html, /<span class="sr-only">Tabela de níveis: <\/span>Night Reads/);
  assert.match(html, /aria-label="Abrir jogo: Night Reads"/);
  assert.match(html, /aria-label="Votar: Night Reads"/);
  const item = { content: { kind: "tournament", id: "x", name: "Cup", covers: [], status: "active", currentRound: 1, bracketSize: 4, subject: null, viewerVoted: true, bookCount: 4 }, author: { username: "ana", unavailable: false, avatarUrl: null, readerGlyph: null } };
  const discover = inPortuguese(() => renderToString(createElement(MemoryRouter, null, createElement(DiscoverTicket, { item: item as never }))));
  assert.match(discover, />Votado</);
});

test("the games list speaks Portuguese on every tab", () => {
  const empty = (client: QueryClient) => {
    client.setQueryData(["arenas", "mine"], []);
    client.setQueryData(["arenas", "voted"], []);
    client.setQueryData(["quizzes"], []);
    client.setQueryData(["tierlists"], []);
    client.setQueryData(["tierlists", "voted"], []);
  };
  const page = () => createElement(ArenaListPage);
  assert.match(rendered(page, empty, "/dashboard/arena"), /No tournaments yet\./);
  const tournaments = inPortuguese(() => rendered(page, empty, "/dashboard/arena"));
  assert.match(tournaments, />Jogos</);
  assert.match(tournaments, /Tabelas de níveis, quizzes e torneios da sua biblioteca — <a href="\/arena"[^>]*>explore os jogos públicos<\/a>\./);
  assert.match(tournaments, />Novo torneio</);
  assert.match(tournaments, /Ainda não tem torneios\./);
  assert.match(inPortuguese(() => rendered(page, empty, "/dashboard/arena?tab=tierlists")), /Ainda não tem tabelas de níveis\./);
  assert.match(inPortuguese(() => rendered(page, empty, "/dashboard/arena?tab=quizzes")), />Novo quiz</);
  const created = (client: QueryClient) => {
    empty(client);
    client.setQueryData(["arenas", "mine"], [tournament({ id: "t9", name: "Cup", status: "active", currentRound: 2 })]);
  };
  const withTournament = inPortuguese(() => rendered(page, created, "/dashboard/arena"));
  assert.match(withTournament, /Criado em 3 out 2026/);
  assert.match(withTournament, />Ronda 2</);
  assert.match(withTournament, /aria-label="Abrir jogo: Cup"/);
});

test("the seed page and its slot grid speak Portuguese", () => {
  const page = () => createElement(Routes, null, createElement(Route, { path: "/dashboard/arena/:id/seed", element: createElement(ArenaSeedPage) }));
  assert.match(rendered(page, () => undefined, "/dashboard/arena/new/seed"), /Random fill/);
  const html = inPortuguese(() => rendered(page, () => undefined, "/dashboard/arena/new/seed"));
  assert.match(html, /Chave de 16 livros/);
  assert.match(html, />Torneio sem título</);
  assert.match(html, /0 \/ 16 posições preenchidas/);
  assert.match(html, />Preenchimento aleatório</);
  assert.match(html, />16 livros</);
  assert.match(html, />Guardar progresso</);
  assert.match(html, />Iniciar torneio</);
});

test("the slot grid translates its toolbar and slot labels", () => {
  const grid = () => createElement(SeedSlotGrid, { bracketSize: 4, slots: [{ workId: "w1", title: "Dune", author: "Frank Herbert", cover: null }, null, null, null], onChange: () => undefined, onRandomFill: () => undefined });
  assert.match(rendered(grid), />Random fill</);
  const html = inPortuguese(() => rendered(grid));
  assert.match(html, /1 \/ 4 posições preenchidas/);
  assert.match(html, /aria-label="Posição 1: Dune, mudar de livro"/);
  assert.match(html, /aria-label="Remover Dune da posição 1"/);
  assert.match(html, />Remover</);
  assert.match(html, />Posição 2</);
});

test("an untitled tournament in either language still needs a name", () => {
  assert.equal(hasTournamentName(UNTITLED_TOURNAMENT), false);
  assert.equal(hasTournamentName("Torneio sem título"), false);
  assert.equal(hasTournamentName("Torneio de primavera"), true);
});

test("the character game page speaks Portuguese", () => {
  const cast = { scope: { kind: "series", label: "Dune", coverUrl: null, workCount: 3 }, characters: [{ id: "c1", name: "Paul" }, { id: "c2", name: "Chani" }, { id: "c3", name: "Jessica" }, { id: "c4", name: "Leto" }] };
  const page = () => createElement(Routes, null, createElement(Route, { path: "/work/:id/game", element: createElement(CharacterGamePage) }));
  const prepare = (client: QueryClient) => client.setQueryData(["works", "w1", "cast"], cast);
  assert.match(rendered(page, prepare, "/work/w1/game"), /Create tier list/);
  const html = inPortuguese(() => rendered(page, prepare, "/work/w1/game"));
  assert.match(html, />Jogo de personagens</);
  assert.match(html, />Livro</);
  assert.match(html, />3 livros</);
  assert.match(html, /aria-label="Tipo de jogo"/);
  assert.match(html, /value="Personagens de Dune"/);
  assert.match(html, />Criar tabela de níveis</);
  assert.match(html, /4 personagens/);
});

test("count-1 plurals: English keeps its old wording, Portuguese reads correctly", () => {
  const oneCharacter = (client: QueryClient) => client.setQueryData(["works", "w1", "cast"], { scope: { kind: "work", label: "Dune", coverUrl: null, workCount: 1 }, characters: [{ id: "c1", name: "Paul" }] });
  const page = () => createElement(Routes, null, createElement(Route, { path: "/work/:id/game", element: createElement(CharacterGamePage) }));
  const tierlist = (client: QueryClient) => oneCharacter(client);
  assert.match(rendered(page, tierlist, "/work/w1/game"), /1 characters/);
  assert.match(inPortuguese(() => rendered(page, tierlist, "/work/w1/game")), /1 personagem</);
  const listPage = () => createElement(ArenaListPage);
  const votedLists = (client: QueryClient) => {
    client.setQueryData(["arenas", "mine"], []);
    client.setQueryData(["arenas", "voted"], []);
    client.setQueryData(["quizzes"], []);
    client.setQueryData(["tierlists"], []);
    client.setQueryData(["tierlists", "voted"], [{ id: "v1", name: "Fantasy", voteCode: "abc", covers: [], poolSize: 3, ballotCount: 1, votingOpen: true, viewerVoted: true, promotedAt: null, subject: null }]);
  };
  assert.match(rendered(listPage, votedLists, "/dashboard/arena?tab=tierlists"), />Created by you</);
  assert.match(inPortuguese(() => rendered(listPage, votedLists, "/dashboard/arena?tab=tierlists")), />Criadas por si</);
  const quiz = (client: QueryClient) => {
    client.setQueryData(["arenas", "mine"], []);
    client.setQueryData(["arenas", "voted"], []);
    client.setQueryData(["tierlists"], []);
    client.setQueryData(["tierlists", "voted"], []);
    client.setQueryData(["quizzes"], [{ id: "q1", name: "Quiz", voteCode: null, data: { books: [{}], questionCount: 1, questions: [] } }]);
  };
  assert.match(rendered(listPage, quiz, "/dashboard/arena?tab=quizzes"), /1 books/);
  assert.match(inPortuguese(() => rendered(listPage, quiz, "/dashboard/arena?tab=quizzes")), /1 livro</);
});
