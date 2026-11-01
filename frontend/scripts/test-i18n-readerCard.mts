import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_READER_CARD_STYLE, READER_CARD_STYLE_KEY, publicStyle, readerCardInputOf, type Layout, type PublicReaderCard } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";

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
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { HighlightChoice, SignatureChoice } = await import("../src/components/readerCard/ReaderCardChoices.tsx");
const { ReaderCardOptions } = await import("../src/components/readerCard/ReaderCardOptions.tsx");
const { ReaderCardTurner } = await import("../src/components/readerCard/ReaderCardTurner.tsx");
const { ReaderCardViewer } = await import("../src/components/readerCard/ReaderCardViewer.tsx");
const { ReaderGlyphSetting } = await import("../src/components/readerCard/ReaderGlyphSetting.tsx");
const { ReaderCardPage } = await import("../src/pages/ReaderCardPage.tsx");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};

const rendered = (element: () => ReactNode, prepare: (client: QueryClient) => void = () => undefined) => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false, retry: false } } });
  try {
    prepare(client);
    return renderToString(createElement(QueryClientProvider, { client }, createElement(LibrarySaverContext.Provider, { value: createWebLibrarySaver(client) }, createElement(ToastProvider, null, createElement(AuthProvider, null, createElement(MemoryRouter, null, element()))))));
  } finally {
    client.clear();
  }
};

const books = Array.from({ length: 6 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, _genres: ["Fantasy"] }));
const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["genres known for 3 of 3 finished books"],
  dial: { segments: [{ group: "star", books: 3, marked: 1 }] },
  facts: { finished: 3, highlights: 2, series: 0, since: 2020, edition: 2026 },
  style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" },
  chosen: { highlight: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
};
const visitor = (layout: Layout) => readerCardInputOf([], [], "andre", "en", { ...card, style: { ...card.style!, layout } });
const ownInput = (locale: "en" | "pt-PT" = "en") => readerCardInputOf(books, [], "andre", locale, undefined, { style: DEFAULT_READER_CARD_STYLE, coverOf: () => null });
const options = () => createElement(ReaderCardOptions, { scheme: "light", input: ownInput("pt-PT"), onChange: async () => true });
const style = { ...DEFAULT_READER_CARD_STYLE, signature: null, highlight: null };

test("the loading and loaded page chrome stays English by default and translates in Portuguese", () => {
  const english = rendered(() => createElement(ReaderCardPage));
  assert.match(english, /Loading your reader card…/);
  const loading = inPortuguese(() => rendered(() => createElement(ReaderCardPage)));
  assert.match(loading, /A carregar o seu cartão de leitor…/);
  assert.match(loading, />Cartão de leitor</);
  assert.doesNotMatch(loading, /Loading|Reader card/);
  const loaded = (prepare: (client: QueryClient) => void = (client) => client.setQueryData(READER_CARD_STYLE_KEY, style)) => rendered(() => createElement(ReaderCardPage), prepare);
  const englishLoaded = loaded();
  assert.match(englishLoaded, /aria-label="Preview as"/);
  assert.match(englishLoaded, />You</);
  assert.match(englishLoaded, />Visitors</);
  const html = inPortuguese(() => loaded());
  assert.match(html, /aria-label="Pré-visualizar como"/);
  assert.match(html, />O próprio</);
  assert.match(html, />Visitantes</);
  assert.match(html, />Contador</);
  assert.match(html, />Lema</);
  assert.match(html, />Rodapé</);
  assert.match(html, />Cantos</);
  assert.match(html, />Acabamento</);
  assert.match(html, />Impressão</);
  assert.match(html, />Disposição</);
  assert.match(html, /Termine a leitura de um livro para escolher o seu livro emblemático\./);
  assert.match(html, /Ainda não há destaques do Kobo\./);
  assert.match(html, /aria-label="Cartão de leitor"/);
  assert.doesNotMatch(html, /Preview as|Visitors|Counter|Motto|Footer|Corners|Finish|Layout|Signature book|Highlight</);
});

test("the editor's option groups are labelled in Portuguese", () => {
  const html = inPortuguese(() => rendered(options));
  for (const label of ["Contador", "Segundo traço", "Aspeto do lema", "Rodapé à esquerda", "Rodapé à direita", "Cantos", "Acabamento", "Impressão", "Disposição"]) assert.match(html, new RegExp(`aria-label="${label}"`), label);
  assert.match(html, /O seu lema<input/);
  assert.match(html, />Esquerda</);
  assert.match(html, />Direita</);
  assert.match(html, />Verso único</);
  assert.doesNotMatch(html, /Footer left|Your motto|Motto look/);
});

test("signature and highlight choices speak Portuguese", () => {
  const signature = inPortuguese(() => rendered(() => createElement(SignatureChoice, { books, signature: { bookKey: "gone", note: null }, chosen: undefined, onChange: async () => true })));
  assert.match(signature, />Livro emblemático</);
  assert.match(signature, /Já não está na sua biblioteca\./);
  assert.match(signature, />Alterar</);
  assert.match(signature, />Remover</);
  const noted = inPortuguese(() => rendered(() => createElement(SignatureChoice, { books, signature: { bookKey: "k", note: "hi" }, chosen: { title: "Book 0", author: "Author 0", note: "hi" }, onChange: async () => true })));
  assert.match(noted, /Nota/);
  const highlight = inPortuguese(() => rendered(() => createElement(HighlightChoice, { books: [], highlight: null, chosen: undefined, onChange: async () => true })));
  assert.match(highlight, />Destaque</);
  assert.match(highlight, /Ainda não há destaques do Kobo\./);
});

test("the turner announces its pages in Portuguese", () => {
  const english = renderToString(createElement(ReaderCardTurner, { input: visitor("faces"), cardWidth: "w-40" }));
  assert.match(english, /aria-label="Turn the card, page 1 of 3"/);
  const html = inPortuguese(() => renderToString(createElement(ReaderCardTurner, { input: visitor("faces"), cardWidth: "w-40" })));
  assert.match(html, /aria-label="Virar o cartão, página 1 de 3"/);
  assert.match(html, /aria-live="polite"[^>]*>Página 1 de 3</);
  assert.match(html, /aria-label="Páginas"/);
  assert.match(html, /aria-label="Página 2"/);
  const book = inPortuguese(() => renderToString(createElement(ReaderCardTurner, { input: visitor("book"), cardWidth: "w-40" })));
  assert.match(book, /aria-label="Páginas do cartão de leitor"/);
});

test("the viewer dialog and its buttons are Portuguese", () => {
  const html = inPortuguese(() => renderToString(createElement(ReaderCardViewer, { input: { ...visitor("faces"), view: "owner" }, onClose: () => undefined, onEdit: () => undefined })));
  assert.match(html, /role="dialog"[^>]*aria-label="Cartão de leitor"|aria-label="Cartão de leitor"[^>]*role="dialog"/);
  assert.match(html, />Editar cartão</);
  assert.match(html, />Fechar</);
});

test("the glyph setting is Portuguese", () => {
  const html = inPortuguese(() => rendered(() => createElement(ReaderGlyphSetting, { username: "andre", books: [], groups: [] }), (client) => client.setQueryData(["community", "own-profile"], { muralId: null, published: false, feedSettings: { ...DEFAULT_FEED_SETTINGS, readerGlyph: true } })));
  assert.match(html, />Mostrar o meu símbolo de leitor junto ao meu nome</);
  assert.match(html, /É mostrado quando a sua estante for publicada\./);
});

test("the segmented chips can wrap their labels instead of clipping them", () => {
  const source = readFileSync("src/components/readerCard/ReaderCardOptions.tsx", "utf8");
  const segmented = source.slice(source.indexOf("export function Segmented"), source.indexOf("const SAMPLE_MOTTO"));
  assert.doesNotMatch(segmented, /truncate|text-ellipsis|whitespace-nowrap|overflow-hidden text-ellipsis/);
  assert.match(segmented, /px-2 text-center/);
});
