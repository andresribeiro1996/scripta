import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Tierlist, VotingBoard } from "@scripta/shared";

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
Object.defineProperty(globalThis, "window", { value: { location: { origin: "https://atmyshelf.test" } }, configurable: true });

const { setLocalePreference } = await import("../src/i18n/index.ts");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { LibrarySaverContext, createWebLibrarySaver } = await import("../src/hooks/useLibrarySaver.ts");
const { AddBooksSheet } = await import("../src/components/tierlist/AddBooksSheet.tsx");
const { TierBoard } = await import("../src/components/tierlist/TierBoard.tsx");
const { TierColorPicker } = await import("../src/components/tierlist/TierColorPicker.tsx");
const { TierlistResultsView } = await import("../src/components/tierlist/TierlistResultsView.tsx");
const { TierListCreatePage } = await import("../src/pages/TierListCreatePage.tsx");
const { TierListEditorPage } = await import("../src/pages/TierListEditorPage.tsx");
const { VoteTierlistPage } = await import("../src/pages/VoteTierlistPage.tsx");

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

const dune = { Title: "Dune", Attribution: "Frank Herbert", _workId: "w1" };
const tiers = [{ id: "t1", label: "S", color: "#c9482f", workIds: [] as string[] }, { id: "t2", label: "A", color: "#d98a3d", workIds: [] as string[] }];
const board = (over: Partial<VotingBoard> = {}): VotingBoard => ({ name: "Night Reads", tiers, pool: ["w1"], access: "anonymous", votingOpen: true, ballotCount: 2, eligibleVoteCount: 1, promotedAt: null, ranksWorstFirst: false, subject: null, histogram: null, ...over } as VotingBoard);
const tierlist = (over: Partial<Tierlist> = {}): Tierlist => ({ id: "tl1", name: "Night Reads", data: { tiers, pool: ["w1"] }, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", voteCode: null, voteAccess: "anonymous", votingOpen: true, sourceTierlistId: null, promotedAt: null, originCreatorId: "u1", ranksWorstFirst: false, subject: null, ...over });
const voteRoutes = () => createElement(Routes, null, createElement(Route, { path: "/vote/:code", element: createElement(VoteTierlistPage) }));
const editorRoutes = () => createElement(Routes, null, createElement(Route, { element: createElement(Outlet, { context: { setNavHidden: () => undefined } }) }, createElement(Route, { path: "/tl/:id", element: createElement(TierListEditorPage) })));

test("the create page walks the first step in Portuguese", () => {
  const prepare = (client: QueryClient) => client.setQueryData(["library"], { data: { books: [] }, updatedAt: "", shareToken: null, shareUrl: null });
  assert.match(rendered(() => createElement(TierListCreatePage), prepare), /Choose books/);
  const html = inPortuguese(() => rendered(() => createElement(TierListCreatePage), prepare));
  assert.match(html, /Escolher livros/);
  assert.match(html, /Passo 1 de 3/);
  assert.match(html, /Nome da tabela de níveis/);
  assert.match(html, /placeholder="Tabela de níveis sem título"/);
  assert.match(html, /Livros no conjunto · 0/);
  assert.match(html, /Nenhum livro encontrado\./);
  assert.match(html, />Seguinte</);
  assert.doesNotMatch(html, /Choose books|Next|Untitled/);
});

test("the board's structure controls and pool speak Portuguese", () => {
  const props = { data: { tiers, pool: [] }, books: [dune], onChange: () => undefined, structureEditable: true, onAddBooks: () => undefined };
  const html = inPortuguese(() => renderToString(createElement(TierBoard, props)));
  assert.match(html, /aria-label="Etiqueta do nível"/);
  assert.match(html, /aria-label="Mover nível para cima"/);
  assert.match(html, /\+ Adicionar nível/);
  assert.match(html, /Conjunto — 0 livros/);
  assert.match(html, /O conjunto está vazio/);
  assert.match(html, /Arraste para aqui um item do conjunto \(livro\)/);
  assert.match(html, />Adicionar livros</);
  const english = renderToString(createElement(TierBoard, props));
  assert.match(english, /Pool — 0 books/);
  assert.match(english, /Drag a book here from the pool\./);
});

test("the colour picker and add-books sheet translate", () => {
  const picker = inPortuguese(() => renderToString(createElement(TierColorPicker, { color: "#c9482f", onChange: () => undefined })));
  assert.match(picker, /aria-label="Cor do nível"/);
  const sheet = inPortuguese(() => renderToString(createElement(AddBooksSheet, { books: [dune], onAdd: () => undefined, onClose: () => undefined })));
  assert.match(sheet, /Adicionar livros ao conjunto/);
  assert.match(sheet, /Escolha livros para adicionar/);
  assert.match(sheet, /placeholder="Pesquisar na sua biblioteca…"/);
});

test("the results view counts votes and ballots in Portuguese", () => {
  const props = { histogram: [{ workId: "w1", tierId: "t1", votes: 2 }], tierIds: ["t1", "t2"], tiers, pool: ["w1"], books: [dune], ballotCount: 2 };
  const html = inPortuguese(() => rendered(() => createElement(TierlistResultsView, props)));
  assert.match(html, /2 votos/);
  assert.match(html, /2 votos · 100% de concordância/);
  assert.match(html, /aria-label="Sobre Dune"/);
  assert.match(html, /Ninguém classificou aqui/);
  assert.match(rendered(() => createElement(TierlistResultsView, { ...props, ballotCount: 1 })), /1 ballot</);
});

test("the voting page translates each of its states", () => {
  const prepare = (value: VotingBoard) => (client: QueryClient) => client.setQueryData(["tierlists", "voting", "abc"], { board: value, books: [] });
  const open = inPortuguese(() => rendered(voteRoutes, prepare(board()), "/vote/abc"));
  assert.match(open, />Enviar voto</);
  assert.match(open, /Arraste livros para os níveis/);
  assert.match(open, />Livros</);
  assert.match(rendered(voteRoutes, prepare(board()), "/vote/abc"), />Submit ballot</);
  const members = inPortuguese(() => rendered(voteRoutes, prepare(board({ access: "members", ranksWorstFirst: true })), "/vote/abc"));
  assert.match(members, />Iniciar sessão para votar</);
  assert.match(members, /Nível de topo = pior/);
  assert.match(members, /só aceita votos de membros/);
  const closed = inPortuguese(() => rendered(voteRoutes, prepare(board({ votingOpen: false })), "/vote/abc"));
  assert.match(closed, /A votação está encerrada\./);
  assert.match(closed, /2 votos/);
  const loading = inPortuguese(() => rendered(voteRoutes, () => undefined, "/vote/abc"));
  assert.match(loading, /A carregar…/);
});

test("the editor page translates the owner's controls and the locked poll panel", () => {
  const prepare = (list: Tierlist, voting?: VotingBoard) => (client: QueryClient) => {
    client.setQueryData(["library"], { data: { books: [dune] }, updatedAt: "", shareToken: null, shareUrl: null, works: {} });
    client.setQueryData(["tierlists"], [list]);
    if (voting && list.voteCode) client.setQueryData(["tierlists", "voting", list.voteCode], { board: voting, books: [] });
  };
  const own = inPortuguese(() => rendered(editorRoutes, prepare(tierlist({ data: { tiers: [], pool: [] } })), "/tl/tl1"));
  assert.match(own, />Editar</);
  assert.match(own, />Abrir para votação</);
  assert.match(own, /title="Mudar o nome desta tabela de níveis"/);
  assert.match(own, /Ainda sem níveis — toque em Editar para adicionar um\./);
  const missing = inPortuguese(() => rendered(editorRoutes, prepare(tierlist()), "/tl/nope"));
  assert.match(missing, /Nenhuma tabela de níveis com esse identificador\./);
  const published = inPortuguese(() => rendered(editorRoutes, prepare(tierlist({ voteCode: "abc" }), board()), "/tl/tl1"));
  assert.match(published, /Esta tabela de níveis pública está bloqueada/);
  assert.match(published, /2 votos · 1\/100 votantes elegíveis/);
  assert.match(published, />Classificar o seu voto</);
  assert.match(published, />Encerrar votação</);
  assert.match(published, />Resultados</);
});
