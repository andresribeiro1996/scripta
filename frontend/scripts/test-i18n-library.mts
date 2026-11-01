import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
const { PublicLibraryGrid } = await import("../src/components/PublicLibraryGrid.tsx");
const { LibraryToolbar } = await import("../src/components/LibraryToolbar.tsx");
const { BookCard } = await import("../src/components/BookCard.tsx");
const { BookSummary } = await import("../src/components/BookSummary.tsx");
const { SharedLibraryPage } = await import("../src/pages/SharedLibraryPage.tsx");
const { SavedPage } = await import("../src/pages/SavedPage.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};
const withClient = (element: ReturnType<typeof createElement>) => {
  const client = new QueryClient();
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, element)));
  } finally {
    client.clear();
  }
};

test("an empty public library says so in Portuguese", () => {
  const library = { books: [] } as never;
  assert.match(withClient(createElement(PublicLibraryGrid, { library })), /This library is empty\./);
  assert.match(inPortuguese(() => withClient(createElement(PublicLibraryGrid, { library }))), /Esta biblioteca está vazia\./);
});

test("the library toolbar translates its labels, filters and sort options", () => {
  const props = { query: "", onQueryChange: () => undefined, status: "all" as const, onStatusChange: () => undefined, counts: { all: 3, reading: 1, finished: 1, unread: 1 }, sort: "manual" as const, onSortChange: () => undefined };
  const english = withClient(createElement(LibraryToolbar, props));
  assert.match(english, /aria-label="Sort books"/);
  assert.match(english, />All<span/);
  const html = inPortuguese(() => withClient(createElement(LibraryToolbar, props)));
  assert.match(html, /aria-label="Ordenar livros"/);
  assert.match(html, />Todos<span/);
  assert.match(html, /aria-label="Pesquisar na sua biblioteca"/);
  assert.doesNotMatch(html, /Sort books|Search your library/);
});

test("a book card falls back to Portuguese placeholders and button labels", () => {
  const book = { ReadStatus: 2 };
  const card = (extra: object) => createElement(BookCard, { book: { ...book, ...extra }, onClick: () => undefined });
  assert.match(withClient(card({ highlights: [{}] })), />1 highlight</);
  const html = inPortuguese(() => withClient(createElement(BookCard, { book: { ...book, highlights: [{}, {}] }, onClick: () => undefined, onOpenStyle: () => undefined, onOpenCoverPicker: () => undefined })));
  assert.match(html, />Sem título</);
  assert.match(html, />2 destaques</);
  assert.match(html, />Autor desconhecido</);
  assert.match(html, />Estilo</);
  assert.match(html, />Capa</);
  assert.match(html, /title="Dar a este livro o seu próprio estilo"/);
});

test("the book summary shows the rating label and loading state in Portuguese", () => {
  const html = inPortuguese(() => withClient(createElement(BookSummary, { book: { Title: "Dune", Rating: 4 } })));
  assert.match(html, /A sua classificação/);
  assert.match(html, /Sobre este livro/);
  assert.match(html, /A carregar sinopse e classificação…/);
});

test("a shared library with no token explains the link in Portuguese", () => {
  const html = inPortuguese(() => withClient(createElement(SharedLibraryPage)));
  assert.match(html, /Esta ligação é inválida ou já não está ativa\./);
  assert.match(html, /Biblioteca/);
});

test("the saved page loads and titles itself in Portuguese", () => {
  const html = inPortuguese(() => withClient(createElement(ToastProvider, null, createElement(SavedPage))));
  assert.match(html, /A carregar itens guardados…/);
  assert.match(html, /Guardados/);
});
