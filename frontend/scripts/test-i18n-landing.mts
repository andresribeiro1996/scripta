import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
const { LandingPage } = await import("../src/pages/LandingPage.tsx");
const { WaitlistForm } = await import("../src/components/landing/WaitlistForm.tsx");
const { ReaderCardPreview } = await import("../src/components/landing/ReaderCardPreview.tsx");
const shared = await import("@scripta/shared");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};
const page = () =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, { initialEntries: ["/"] }, createElement(AuthProvider, null, createElement(LandingPage)))),
  );

test("the landing page renders in Portuguese", () => {
  const html = inPortuguese(page);
  assert.match(html, /Os seus livros\. O seu mundo\./);
  assert.match(html, /Esteja lá para o primeiro capítulo\./);
  assert.match(html, /aria-label="Atmyshelf, página inicial"/);
  assert.match(html, /aria-label="Mudar para o tema escuro"/);
  assert.match(html, />Privacidade</);
  assert.match(html, /Mural de exemplo/);
  assert.match(html, />Virar para explorar</);
  assert.doesNotMatch(html, /Your books|Turn to explore|Privacy|Example mural/);
});

test("the landing page stays in English by default", () => {
  const html = page();
  assert.match(html, /Your books\. Your world\./);
  assert.match(html, /Be there for the first chapter\./);
  assert.match(html, /aria-label="Atmyshelf home"/);
  assert.match(html, /aria-label="Switch to dark theme"/);
  assert.match(html, />Privacy</);
});

test("the waitlist form translates its field, placeholder and button", () => {
  const html = inPortuguese(() => renderToStaticMarkup(createElement(WaitlistForm, { label: "x" })));
  assert.match(html, /placeholder="Endereço de email"/);
  assert.match(html, /aria-label="Avisar-me"/);
  assert.match(html, /title="Receber aviso no lançamento"/);
});

test("the reader card preview draws its plate in Portuguese, not from the English static files", () => {
  const { plateName } = shared;
  const decoded = (html: string) => [...html.matchAll(/src="(data:image\/svg\+xml,[^"]+)"/g)].map((match) => decodeURIComponent(match[1].replace(/&amp;/g, "&").slice("data:image/svg+xml,".length)));
  const preview = () => renderToStaticMarkup(createElement(ReaderCardPreview));
  const portuguese = inPortuguese(() => decoded(preview()).join("\n"));
  assert.ok(portuguese.length > 0);
  assert.doesNotMatch(portuguese, new RegExp(`\\b(EXAMPLE READER|${shared.READER_PLATES.map((plate) => plateName(plate.key, "en")).join("|")})\\b`));
  assert.match(portuguese, /LEITOR DE EXEMPL/);
  assert.ok(shared.READER_PLATES.some((plate) => portuguese.includes(plateName(plate.key, "pt-PT"))));
  const english = decoded(preview()).join("\n");
  assert.match(english, /EXAMPLE READER/);
});
