import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

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
const { LoginPage } = await import("../src/pages/LoginPage.tsx");
const { NotFoundPage } = await import("../src/pages/NotFoundPage.tsx");
const { SidebarNav } = await import("../src/components/page/SidebarNav.tsx");
const { Sheet } = await import("../src/components/Sheet.tsx");
const { NAV_AREAS, backTo, area } = await import("../src/lib/areas.ts");

const inPortuguese = (render: () => string) => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};
const routed = (path: string, element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(AuthProvider, null, element)));

test("the login page renders in Portuguese", () => {
  const html = inPortuguese(() => routed("/login", createElement(LoginPage)));
  assert.match(html, /<h1[^>]*>Bom regresso<\/h1>/);
  assert.match(html, />Iniciar sessão</);
  assert.match(html, />Palavra-passe</);
  assert.doesNotMatch(html, /Log in|Welcome back/);
});

test("the page-not-found screen renders in Portuguese", () => {
  const html = inPortuguese(() => routed("/nope", createElement(NotFoundPage)));
  assert.match(html, /Esta página não existe\./);
});

test("area labels, tabs and back links follow the active language", () => {
  assert.deepEqual(NAV_AREAS.map((a) => a.label).slice(0, 2), ["Home", "Library"]);
  inPortuguese(() => {
    assert.deepEqual(NAV_AREAS.map((a) => a.label), ["Início", "Biblioteca", "Murais", "Jogos", "Cartão de leitor", "Comunidade", "Definições"]);
    assert.deepEqual(area("library").tabs.map((tab) => tab.label), ["Livros", "Séries", "Coleções", "Galeria"]);
    assert.equal(backTo("tournament").label, "Jogos");
    assert.equal(area("admin").label, "Admin");
    return "";
  });
});

test("the sidebar and a sheet translate their own chrome", () => {
  const nav = inPortuguese(() => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SidebarNav, { areas: NAV_AREAS, activeId: null, homeBadge: "3" }))));
  assert.match(nav, /aria-label="Início, 3 novos"/);
  const sheet = inPortuguese(() => renderToStaticMarkup(createElement(Sheet, { title: "X", onClose: () => {} }, "body")));
  assert.match(sheet, /aria-label="Fechar"/);
});
