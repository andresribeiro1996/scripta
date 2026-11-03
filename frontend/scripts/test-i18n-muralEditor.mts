import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MuralBlock } from "@scripta/shared";

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
const { LibrarySaverContext, createWebLibrarySaver } = await import("../src/hooks/useLibrarySaver.ts");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { AddBlockMenu } = await import("../src/components/murals/AddBlockMenu.tsx");
const { BlockConfigPanel } = await import("../src/components/murals/BlockConfigPanel.tsx");
const { BlockStylePanel } = await import("../src/components/murals/BlockStylePanel.tsx");
const { MoveToFolderModal } = await import("../src/components/murals/MoveToFolderModal.tsx");
const { MuralFolderTree } = await import("../src/components/murals/MuralFolderTree.tsx");
const { BlockRenderer } = await import("../src/components/murals/BlockRenderer.tsx");
const { MuralBlockDetail } = await import("../src/components/murals/MuralBlockDetail.tsx");
const { MuralEditorPage } = await import("../src/pages/MuralEditorPage.tsx");

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

const layout = { x: 0, y: 0, w: 12, h: 6 };
const profileBlock = { id: "p1", type: "profile", bio: "", favoriteGenres: ["Fantasy"], layout } as unknown as MuralBlock;
const statsBlock = { id: "s1", type: "stats", metrics: ["totalBooks", "booksFinished", "booksInProgress", "totalHighlights"], layout } as unknown as MuralBlock;
const tierlistBlock = { id: "t1", type: "tierlist", tierlistId: "tl1", layout } as unknown as MuralBlock;
const books = [
  { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 2, _workId: "w1" },
  { Attribution: "Anónimo", ReadStatus: 1 },
  { Title: "Hobbit", ReadStatus: 0 }
];
const config = (block: MuralBlock) => () => createElement(BlockConfigPanel, { block, books, images: [], onSave: () => undefined, onClose: () => undefined });
const render = (block: MuralBlock, extra: Record<string, unknown> = {}) => () => createElement(BlockRenderer, { block, books, images: [], ...extra });
const editorRoutes = () => createElement(Routes, null, createElement(Route, { element: createElement(Outlet, { context: { setNavHidden: () => undefined } }) }, createElement(Route, { path: "/dashboard/murals/:muralId", element: createElement(MuralEditorPage) })));
const draft = (client: QueryClient) => {
  client.setQueryData(["murals"], []);
  client.setQueryData(["library"], { data: { books: [], groups: [] }, updatedAt: "", shareToken: null, shareUrl: null });
};

test("the add-block menu stays in English by default and translates in Portuguese", () => {
  const english = rendered(() => createElement(AddBlockMenu, { onAdd: () => undefined }));
  assert.match(english, /aria-label="Add a block"/);
  assert.match(english, /\+ Add block/);
  const html = inPortuguese(() => rendered(() => createElement(AddBlockMenu, { onAdd: () => undefined })));
  assert.match(html, /aria-label="Adicionar um bloco"/);
  assert.match(html, /\+ Adicionar bloco/);
  assert.doesNotMatch(html, /Add a block|Add block/);
});

test("the mural editor draft renders in Portuguese", () => {
  const english = rendered(editorRoutes, draft, "/dashboard/murals/new");
  assert.match(english, /Untitled mural/);
  assert.match(english, />Theme</);
  assert.match(english, />Edit</);
  assert.match(english, /This mural is empty\./);
  assert.match(english, /Turn on editing and add your first block\./);
  const html = inPortuguese(() => rendered(editorRoutes, draft, "/dashboard/murals/new"));
  assert.match(html, /Mural sem título/);
  assert.match(html, /title="Mudar o nome deste mural"/);
  assert.match(html, />Tema</);
  assert.match(html, />Editar</);
  assert.match(html, /Este mural está vazio\./);
  assert.match(html, /Ative a edição e adicione o seu primeiro bloco\./);
  assert.match(html, />Começar a construir</);
  assert.doesNotMatch(html, /Untitled|Theme|Turn on editing/);
  const missing = inPortuguese(() => rendered(editorRoutes, draft, "/dashboard/murals/nope"));
  assert.match(missing, /Não existe nenhum mural com esse identificador\./);
});

test("the block settings panel names the block and its genres in Portuguese", () => {
  const profile = inPortuguese(() => rendered(config(profileBlock)));
  assert.match(profile, /Perfil de leitor/);
  assert.match(profile, /Biografia/);
  assert.match(profile, /De que gosto/);
  assert.match(profile, />Fantasia</);
  assert.match(profile, />Guardar</);
  assert.match(profile, />Cancelar</);
  assert.match(rendered(config(profileBlock)), />Fantasy</);
  const stats = inPortuguese(() => rendered(config(statsBlock)));
  assert.match(stats, /Livros na sua biblioteca/);
  assert.match(stats, /Escolha os números a mostrar/);
  const tierlist = inPortuguese(() => rendered(config(tierlistBlock)));
  assert.match(tierlist, /Tabela de níveis/);
  assert.match(tierlist, /A carregar tabelas de níveis…/);
});

test("the block style panel and folder pickers translate", () => {
  const style = inPortuguese(() => rendered(() => createElement(BlockStylePanel, { block: profileBlock, onSave: () => undefined, onClose: () => undefined, preview: () => null })));
  assert.match(style, /Estilo do bloco/);
  assert.match(style, />Fundo</);
  assert.match(style, />Contorno</);
  assert.match(style, />Efeitos</);
  const folders = [{ id: "f1", name: "Favoritos", parentId: null }];
  const move = inPortuguese(() => rendered(() => createElement(MoveToFolderModal, { title: "Parede", folders, disabledIds: new Set<string>(), onSelect: () => undefined, onClose: () => undefined })));
  assert.match(move, /Mover “Parede”/);
  assert.match(move, /Todos os murais \(raiz\)/);
  const tree = inPortuguese(() => rendered(() => createElement(MuralFolderTree, { folders, selectedFolderId: null, onSelect: () => undefined, onCreateFolder: () => undefined, onRenameFolder: () => undefined, onMoveFolder: () => undefined, onDeleteFolder: () => undefined })));
  assert.match(tree, /\+ Nova pasta/);
  assert.match(tree, /Todos os murais/);
});

test("the block views render their labels in Portuguese", () => {
  const stats = inPortuguese(() => rendered(render(statsBlock)));
  assert.match(stats, /A sua biblioteca/);
  assert.match(stats, /de 3 lidos/);
  assert.match(stats, /1 lido/);
  assert.match(stats, /1 a ler/);
  assert.match(stats, /1 por ler/);
  assert.match(rendered(render(statsBlock)), /of 3 finished/);
  const empty = { ...statsBlock, metrics: [] } as unknown as MuralBlock;
  assert.match(inPortuguese(() => rendered(render(empty))), /Escolha os números a mostrar\./);
  const shelfThemeOverride = { genres: ["Fantasy"], matchedBooks: 2, totalBooks: 3 };
  const profileProps = { profile: { username: "" }, shelfThemeOverride };
  const profile = inPortuguese(() => rendered(render(profileBlock, profileProps)));
  assert.match(profile, />Fantasia</);
  assert.match(profile, /@(<!-- -->)?leitor/);
  assert.match(profile, /De que gosto/);
  assert.match(profile, /O tema da minha estante/);
  assert.match(profile, /Com base em 2 de 3 livros/);
  assert.match(rendered(render(profileBlock, profileProps)), /@(<!-- -->)?reader/);
  assert.match(rendered(render(profileBlock, profileProps)), /Based on 2 of 3 books/);
  const shelf = { id: "sh", type: "shelf", title: "", bookKeys: [], layout } as unknown as MuralBlock;
  const shelfHtml = inPortuguese(() => rendered(render(shelf)));
  assert.match(shelfHtml, /Estante sem título/);
  assert.match(shelfHtml, /0 livros/);
  assert.match(shelfHtml, /Ainda não foram escolhidos livros\./);
  const reading = inPortuguese(() => rendered(render({ id: "cr", type: "currentlyReading", layout } as unknown as MuralBlock)));
  assert.match(reading, /A ler agora/);
  const tiers = [{ id: "a", label: "S", color: "#c9482f", workIds: [] as string[] }];
  const tierlistData = (characters: boolean) => () => ({ name: "", tiers, pool: [], subject: characters ? {} : null });
  const tierlist = inPortuguese(() => rendered(render(tierlistBlock, { tierlistData: tierlistData(false) })));
  assert.match(tierlist, /Tabela de níveis sem título/);
  assert.match(tierlist, /Não há livros neste nível\./);
  assert.match(rendered(render(tierlistBlock, { tierlistData: tierlistData(false) })), /No books on this tier\./);
  const characterBooks = [{ Title: "Paul", _workId: "w1", _character: true }];
  const characters = inPortuguese(() => rendered(() => createElement(BlockRenderer, { block: tierlistBlock, books: characterBooks, images: [], tierlistData: tierlistData(true) })));
  assert.match(characters, /Não há personagens neste nível\./);
  assert.match(inPortuguese(() => rendered(render(tierlistBlock))), /Tabela de níveis indisponível\./);
});

test("the block detail sheet translates its fallbacks", () => {
  const detail = (block: MuralBlock) => () => createElement(MuralBlockDetail, { block, theme: "dark", scheme: "dark", books, images: [], onClose: () => undefined });
  const quote = { id: "q1", type: "quote", bookKey: "", highlightId: "", layout } as unknown as MuralBlock;
  assert.match(inPortuguese(() => rendered(detail(quote))), /Ainda não foram adicionadas citações\./);
  assert.match(rendered(detail(quote)), /No quotes added yet\./);
  const shelf = { id: "sh", type: "shelf", title: "Melhores", bookKeys: [], layout } as unknown as MuralBlock;
  assert.match(inPortuguese(() => rendered(detail(shelf))), /Ainda não há livros aqui\./);
  const spotlight = { id: "sp", type: "spotlight", bookKey: "", layout } as unknown as MuralBlock;
  assert.match(inPortuguese(() => rendered(detail(spotlight))), /Nenhum livro selecionado\./);
});
