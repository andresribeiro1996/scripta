import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_LIBRARY_STYLE, extractPerCardStyle, DEFAULT_BLOCK_STYLE } from "@scripta/shared";

registerHooks({
  load: (url, context, next) => {
    if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
    const loaded = next(url, context);
    if (!url.endsWith("/lib/theme.ts")) return loaded;
    const source = String(loaded.source).replace("()=>readFontPreference(slot))", '()=>readFontPreference(slot),()=>"theme")');
    assert.notEqual(source, String(loaded.source));
    return { ...loaded, source };
  }
});

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
const { LibrarySaverContext, createWebLibrarySaver } = await import("../src/hooks/useLibrarySaver.ts");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { SettingsPage } = await import("../src/pages/SettingsPage.tsx");
const { SettingsAppearancePage } = await import("../src/pages/SettingsAppearancePage.tsx");
const { LibraryStylePage } = await import("../src/pages/LibraryStylePage.tsx");
const { PerCardStylePanel } = await import("../src/components/PerCardStylePanel.tsx");
const { BlockBackgroundSection, BlockEffectsSection, BlockTextSection } = await import("../src/components/StyleControls.tsx");
const { ThemeOptionGrid } = await import("../src/components/ThemeOptionGrid.tsx");
const { FontPicker } = await import("../src/components/FontPicker.tsx");

const inPortuguese = <T extends unknown>(render: () => T): T => {
  setLocalePreference("pt-PT");
  try {
    return render();
  } finally {
    setLocalePreference("auto");
  }
};

const rendered = (element: () => ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false, retry: false } } });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(LibrarySaverContext.Provider, { value: createWebLibrarySaver(client) }, createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(AuthProvider, null, createElement(MemoryRouter, null, element())))))));
  } finally {
    client.clear();
  }
};

test("the settings page chrome stays English by default and translates in Portuguese", () => {
  const english = rendered(() => createElement(SettingsPage));
  assert.match(english, />Settings</);
  assert.match(english, />Profile</);
  assert.match(english, />Change username</);
  const html = inPortuguese(() => rendered(() => createElement(SettingsPage)));
  assert.match(html, />Definições</);
  assert.match(html, />Perfil</);
  assert.match(html, />Alterar nome de utilizador</);
  assert.doesNotMatch(html, /Settings|Profile|Change username/);
});

test("the appearance page translates its group, themes and fonts", () => {
  const english = rendered(() => createElement(SettingsAppearancePage));
  assert.match(english, />Appearance</);
  assert.match(english, />Headings</);
  assert.match(english, /Theme default · /);
  const html = inPortuguese(() => rendered(() => createElement(SettingsAppearancePage)));
  assert.match(html, />Aspeto</);
  assert.match(html, />Títulos</);
  assert.match(html, />Texto</);
  assert.match(html, />Sistema</);
  assert.match(html, /Predefinição do tema · /);
  assert.match(html, /<legend[^>]*>Tema<\/legend>/);
  assert.doesNotMatch(html, /Appearance|Headings|Theme default/);
});

test("the library style page translates its sections and sliders", () => {
  const english = rendered(() => createElement(LibraryStylePage));
  assert.match(english, /Preview \(sample books — your library is empty\)/);
  assert.match(english, />Card size</);
  assert.match(english, />Reset all to defaults</);
  const html = inPortuguese(() => rendered(() => createElement(LibraryStylePage)));
  assert.match(html, /Pré-visualização \(livros de exemplo — a sua biblioteca está vazia\)/);
  assert.match(html, />Disposição dos cartões</);
  assert.match(html, />Tamanho dos cartões</);
  assert.match(html, />Aspeto do cartão</);
  assert.match(html, />Contorno do cartão</);
  assert.match(html, />Fundo da biblioteca</);
  assert.match(html, />Repor todas as predefinições</);
  assert.doesNotMatch(html, /Card size|Card layout|Reset all|Spacing between/);
});

test("the per-card style panel builds its sentences around the translated priority text", () => {
  const panel = (customized: boolean, priorityText: string) =>
    rendered(() => createElement(PerCardStylePanel, { idPrefix: "t", name: "Dune", priorityText, currentOverride: customized ? extractPerCardStyle(DEFAULT_LIBRARY_STYLE) : undefined, seedStyle: DEFAULT_LIBRARY_STYLE, onSave: () => undefined, onClose: () => undefined }));
  const english = panel(false, "the library-wide");
  assert.match(english, /Takes priority over the library-wide style\./);
  assert.match(english, /Currently uses the library-wide style\. Turn this on to override it\./);
  assert.match(english, /Style for &quot;Dune&quot;/);
  const html = inPortuguese(() => panel(false, "de toda a biblioteca"));
  assert.match(html, /Tem prioridade sobre o estilo de toda a biblioteca\./);
  assert.match(html, /Usa atualmente o estilo de toda a biblioteca\. Ative esta opção para o substituir\./);
  assert.match(html, /Estilo de &quot;Dune&quot;/);
  assert.match(html, />Estilo personalizado</);
  const series = inPortuguese(() => panel(false, "da série e de toda a biblioteca"));
  assert.match(series, /Tem prioridade sobre o estilo da série e de toda a biblioteca\./);
  const open = inPortuguese(() => panel(true, "de toda a biblioteca"));
  assert.match(open, />Aspeto do cartão</);
  assert.match(open, />Forma da capa</);
  assert.match(open, />Texto do cartão</);
  assert.match(open, />Negrito</);
  assert.doesNotMatch(open, /Corner radius|Cover shape|Bold|Italic/);
});

test("the mural block sections translate through the same controls", () => {
  const noop = () => undefined;
  const html = inPortuguese(() =>
    rendered(() => createElement("div", null,
      createElement(BlockBackgroundSection, { idPrefix: "b", draft: { ...DEFAULT_BLOCK_STYLE, gradientColor: "theme:accent" }, onApply: noop, onSaveNow: noop }),
      createElement(BlockEffectsSection, { idPrefix: "e", draft: { ...DEFAULT_BLOCK_STYLE, cardShadow: true }, onApply: noop, onSaveNow: noop }),
      createElement(BlockTextSection, { idPrefix: "x", draft: DEFAULT_BLOCK_STYLE, onApply: noop, onSaveNow: noop }))));
  for (const text of ["Fundo", "Sem fundo", "Segunda cor", "Cor do tema: ", "Usar uma cor personalizada", "Efeitos", "Opacidade do bloco", "Intensidade da sombra", "Texto do bloco", "Alinhamento", "Estilo de código"]) assert.match(html, new RegExp(text), text);
  assert.doesNotMatch(html, /No background|Theme color|Block opacity|Code style|Alignment/);
});

test("the theme grid and font picker label themselves in Portuguese", () => {
  const grid = inPortuguese(() => renderToStaticMarkup(createElement(ThemeOptionGrid, { options: ["system", "light"] as const, value: "system", onChange: () => undefined })));
  assert.match(grid, />Sistema</);
  const picker = inPortuguese(() => rendered(() => createElement(FontPicker, { slot: "text" })));
  assert.match(picker, />Texto</);
});
