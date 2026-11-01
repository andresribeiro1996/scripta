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

const { setLocalePreference } = await import("../src/i18n/index.ts");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { ProfileActivity } = await import("../src/components/ProfileActivity.tsx");
const { SocialsSection } = await import("../src/components/SocialsSection.tsx");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { DiscoverPage } = await import("../src/pages/DiscoverPage.tsx");
const { PeoplePage } = await import("../src/pages/PeoplePage.tsx");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};

const rendered = (element: () => ReactNode, prepare: (client: QueryClient) => void = () => undefined) => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  try {
    prepare(client);
    return renderToString(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(AuthProvider, null, createElement(MemoryRouter, null, element()))))));
  } finally {
    client.clear();
  }
};

test("Discover speaks Portuguese: title, subtitle, filters and empty state", () => {
  const page = () => createElement(DiscoverPage);
  const prepare = (client: QueryClient) => client.setQueryData(["community", "discover", "all", ""], { pages: [{ items: [], nextOffset: null }], pageParams: [0] });
  assert.match(rendered(page, prepare), /Tier lists, tournaments and quizzes readers have published\./);
  const html = inPortuguese(() => rendered(page, prepare));
  assert.match(html, />Comunidade</);
  assert.match(html, /Tabelas de níveis, torneios e quizzes publicados por leitores\./);
  assert.match(html, />Torneios</);
  assert.match(html, /placeholder="Pesquisar jogos"/);
  assert.match(html, /aria-label="Tipo"/);
  assert.match(html, /Ainda não há nada publicado\./);
  assert.doesNotMatch(html, /Nothing published yet|Search games/);
});

test("People speaks Portuguese: subtitle, search and empty state", () => {
  const prepare = (client: QueryClient) => client.setQueryData(["community", "people", "suggested"], []);
  const html = inPortuguese(() => rendered(() => createElement(PeoplePage), prepare));
  assert.match(html, /Encontre leitores e siga-os para ver o que andam a fazer\./);
  assert.match(html, /placeholder="Pesquisar por nome de utilizador"/);
  assert.match(html, /Encontre pessoas\./);
  assert.doesNotMatch(html, /Find people/);
});

test("People suggestions translate the follow button", () => {
  const person = { user: { userId: "u1", username: "ana", avatarUrl: null }, followerCount: 3, viewerFollows: true, private: false, sharedCount: 2, sharedBooks: [] };
  const prepare = (client: QueryClient) => client.setQueryData(["community", "people", "suggested"], [person]);
  assert.match(rendered(() => createElement(PeoplePage), prepare), /aria-label="Following ana"/);
  const html = inPortuguese(() => rendered(() => createElement(PeoplePage), prepare));
  assert.match(html, /aria-label="A seguir ana"/);
  assert.match(html, />Leitores de que poderá gostar</);
  assert.doesNotMatch(html, /Readers you might like/);
});

test("profile activity speaks Portuguese when empty", () => {
  const activity = { isLoading: false, error: null, items: [], hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => undefined, refetch: () => undefined } as never;
  const html = inPortuguese(() => rendered(() => createElement(ProfileActivity, { activity })));
  assert.match(html, /Ainda não há atividade\./);
  assert.match(html, /As publicações e as leituras aparecem aqui\./);
  assert.doesNotMatch(html, /No activity yet/);
});

test("the socials section speaks Portuguese", () => {
  const socials = [
    { provider: "x", enabled: true, connected: true, handle: "@ana", connectedAt: null },
    { provider: "bluesky", enabled: true, connected: false, handle: null, connectedAt: null },
    { provider: "tiktok", enabled: false, connected: false, handle: null, connectedAt: null }
  ];
  const prepare = (client: QueryClient) => client.setQueryData(["socials"], socials);
  assert.match(rendered(() => createElement(SocialsSection), prepare), /Connected as @ana\./);
  const html = inPortuguese(() => rendered(() => createElement(SocialsSection), prepare));
  assert.match(html, />Redes sociais</);
  assert.match(html, /Ligado como @ana\./);
  assert.match(html, /aria-label="Desligar X"/);
  assert.match(html, /aria-label="Ligar Bluesky"/);
  assert.match(html, /Ainda não configurado neste servidor\./);
  assert.match(html, /Inicie sessão com uma palavra-passe de aplicação/);
  assert.doesNotMatch(html, /Connected as|Not set up/);
});
