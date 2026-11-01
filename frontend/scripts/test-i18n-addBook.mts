import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const { setLocalePreference, t } = await import("../src/i18n/index.ts");
const { AddBookModal } = await import("../src/components/AddBookModal.tsx");
const { AddBookSheet } = await import("../src/components/AddBookSheet.tsx");
const { FeelingChips } = await import("../src/components/FeelingChips.tsx");
const { SyncGoodreadsModal } = await import("../src/components/SyncGoodreadsModal.tsx");
const { CoverPickerModal } = await import("../src/components/CoverPickerModal.tsx");
const { ShareModal } = await import("../src/components/ShareModal.tsx");
const { ShareLinkRow } = await import("../src/components/ShareLinkRow.tsx");
const { ConfirmProvider } = await import("../src/components/ConfirmDialog.tsx");
const { AuthProvider } = await import("../src/auth/AuthContext.tsx");
const { createWebLibrarySaver, LibrarySaverContext } = await import("../src/hooks/useLibrarySaver.ts");
const { ToastProvider } = await import("../src/components/Toaster.tsx");
const { shareLink } = await import("../src/lib/shareLink.ts");
const { MuralConflictError } = await import("../src/hooks/useMurals.ts");

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
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          LibrarySaverContext.Provider,
          { value: createWebLibrarySaver(client) },
          createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(ToastProvider, null, createElement(ConfirmProvider, null, element))))
        )
      )
    );
  } finally {
    client.clear();
  }
};

test("the add-a-book dialog translates its title, fields and status options", () => {
  const props = { onAdd: async () => undefined, onClose: () => undefined };
  const english = withClient(createElement(AddBookModal, props));
  assert.match(english, />Add a book</);
  assert.match(english, />To read</);
  const html = inPortuguese(() => withClient(createElement(AddBookModal, props)));
  assert.match(html, />Adicionar um livro</);
  assert.match(html, />Quero ler</);
  assert.match(html, />Título e autor são obrigatórios\.</);
  assert.doesNotMatch(html, /Add a book|Title and author are required/);
});

test("the add-to-library sheet asks a signed-out visitor to sign in in Portuguese", () => {
  const book = { title: "Dom Casmurro", author: "Machado de Assis" };
  assert.match(withClient(createElement(AddBookSheet, { book, onClose: () => undefined })), /Sign in to add books to your library\./);
  const html = inPortuguese(() => withClient(createElement(AddBookSheet, { book, onClose: () => undefined })));
  assert.match(html, /Adicionar à sua biblioteca/);
  assert.match(html, /Inicie sessão para adicionar livros à sua biblioteca\./);
});

test("the feeling chips take their default label from the catalog", () => {
  const props = { value: null, onChange: () => undefined };
  assert.match(withClient(createElement(FeelingChips, props)), /aria-label="How did it land\?"/);
  assert.match(inPortuguese(() => withClient(createElement(FeelingChips, props))), /aria-label="O que achou\?"/);
});

test("the Goodreads sync, cover picker, share modal and link row translate", () => {
  const sync = inPortuguese(() => withClient(createElement(SyncGoodreadsModal, { onFile: async () => undefined, onClose: () => undefined })));
  assert.match(sync, /Sincronizar com o Goodreads/);
  const cover = inPortuguese(() =>
    withClient(createElement(CoverPickerModal, { title: "Dom Casmurro", currentImageId: null, onSelect: () => undefined, onRemoveCover: () => undefined, onClose: () => undefined }))
  );
  assert.match(cover, /Capa de &quot;Dom Casmurro&quot;/);
  const share = inPortuguese(() =>
    withClient(createElement(ShareModal, { title: "Dom Casmurro", shareToken: null, shareUrl: null, defaultCaption: "", onShare: async () => ({ shareToken: "a", shareUrl: "b" }), onUnshare: async () => undefined, onClose: () => undefined }))
  );
  assert.match(share, /Partilhar &quot;Dom Casmurro&quot;/);
  assert.match(share, /Criar ligação de partilha/);
  const row = inPortuguese(() => renderToStaticMarkup(createElement(ShareLinkRow, { url: "https://x", copied: false, onCopy: () => undefined })));
  assert.match(row, /Copiar ligação/);
});

test("the import errors thrown by fileImport come from the catalog", () => {
  const source = readFileSync(new URL("../src/lib/fileImport.ts", import.meta.url), "utf8");
  assert.match(source, /t\("addBook\.importNotLibraryJson"\)/);
  assert.match(source, /t\("addBook\.importNotRecognized"\)/);
  assert.match(t("addBook.importNotRecognized"), /^Didn't recognize that file/);
  assert.match(inPortuguese(() => t("addBook.importNotRecognized")), /^Não foi possível reconhecer esse ficheiro/);
});

test("the share toast and the mural conflict error are Portuguese", async () => {
  const toasts: Array<{ message: string }> = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => undefined } }, configurable: true });
  setLocalePreference("pt-PT");
  try {
    await shareLink("T", "u", (options) => void toasts.push(options));
    assert.equal(toasts[0].message, "Ligação copiada.");
    assert.match(new MuralConflictError().message, /foi alterado noutro lugar/);
  } finally {
    setLocalePreference("auto");
    if (original) Object.defineProperty(globalThis, "navigator", original);
  }
});
