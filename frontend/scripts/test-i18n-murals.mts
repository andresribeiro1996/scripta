import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SharedMuralPayload } from "@scripta/shared";

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

const { getLocale, setLocalePreference } = await import("../src/i18n/index.ts");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { buildMuralPreset } = await import("../src/lib/muralPresets.ts");
const { MuralsListPage } = await import("../src/pages/MuralsListPage.tsx");
const { SharedMuralPage } = await import("../src/pages/SharedMuralPage.tsx");

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
    return renderToString(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: [entry] }, element()))))));
  } finally {
    client.clear();
  }
};

const mural = (id: string, name: string, blocks: number) => ({
  id,
  name,
  theme: "dark",
  blocks: Array.from({ length: blocks }, (_, i) => ({ id: `b${i}`, type: "text", heading: "", body: "", layout: { x: 0, y: i * 3, w: 12, h: 3 } })),
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
  shareToken: null,
  shareUrl: null,
  folderId: null
});

const list = () => rendered(() => createElement(MuralsListPage), (client) => {
  client.setQueryData(["murals"], [mural("m1", "Melhores de 2026", 1), mural("m2", "Wall", 3)]);
  client.setQueryData(["muralFolders"], []);
  client.setQueryData(["community", "own-profile"], { muralId: "m1" });
});

const sharedPayload = (blocks: number): SharedMuralPayload => ({
  mural: { id: "m1", name: "Parede", theme: "dark", blocks: mural("m1", "Parede", blocks).blocks, coverImageUrl: null },
  profile: { username: "alice" },
  books: [],
  currentlyReading: [],
  highlights: [],
  imageUrls: {},
  tierlists: {}
} as unknown as SharedMuralPayload);

const shared = (prepare: (client: QueryClient) => void) => rendered(() => createElement(Routes, null, createElement(Route, { path: "/shared/murals/:token", element: createElement(SharedMuralPage) })), prepare, "/shared/murals/tok");

test("the murals list stays in English by default", () => {
  const html = list();
  assert.match(html, /Start from a preset/);
  assert.match(html, /New mural/);
  assert.match(html, /Recently updated/);
  assert.match(html, /1 block · Updated/);
  assert.match(html, /3 blocks · Updated/);
  assert.match(html, />My shelf</);
});

test("the murals list renders in Portuguese", () => {
  const html = inPortuguese(list);
  assert.match(html, /Murais/);
  assert.match(html, /Começar a partir de uma predefinição/);
  assert.match(html, /Novo mural/);
  assert.match(html, /Atualizados recentemente/);
  assert.match(html, /1 bloco · Atualizado em 3 out 2026/);
  assert.match(html, /3 blocos · Atualizado em 3 out 2026/);
  assert.match(html, />A minha estante</);
  assert.match(html, /aria-label="Ordenar murais/);
  assert.match(html, /aria-label="Pesquisar murais por nome"/);
  assert.doesNotMatch(html, /Start from a preset|Recently updated/);
});

test("an empty murals list renders in Portuguese", () => {
  const html = inPortuguese(() => rendered(() => createElement(MuralsListPage), (client) => {
    client.setQueryData(["murals"], []);
    client.setQueryData(["muralFolders"], []);
    client.setQueryData(["community", "own-profile"], { muralId: null });
  }));
  assert.match(html, /Ainda sem murais\./);
});

test("the shared mural renders in Portuguese", () => {
  const empty = inPortuguese(() => shared((client) => client.setQueryData(["sharedMural", "tok"], sharedPayload(0))));
  assert.match(empty, /por @alice/);
  assert.match(empty, /Este mural está vazio\./);
  const withBlocks = inPortuguese(() => shared((client) => client.setQueryData(["sharedMural", "tok"], sharedPayload(1))));
  assert.match(withBlocks, /aria-label="Ver o mural em ecrã inteiro"/);
  assert.match(inPortuguese(() => shared(() => undefined)), /A carregar…/);
  assert.match(shared((client) => client.setQueryData(["sharedMural", "tok"], sharedPayload(0))), /by @alice/);
});

test("a preset created under Portuguese takes its title in Portuguese", () => {
  inPortuguese(() => {
    assert.equal(getLocale(), "pt-PT");
    assert.equal(buildMuralPreset("best", [], getLocale()).name, "Favoritos de sempre");
  });
  assert.equal(buildMuralPreset("best", [], getLocale()).name, "All-time favourites");
});
