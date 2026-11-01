/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { setLocalePreference, t } from "../../i18n";
import { coverStatusLabel } from "../library/lib/addBookDraft";

test("the import preview strings are English by default", () => {
  assert.equal(t("addBook.importChooseFile"), "Choose library file");
  assert.equal(t("errors.notSignedIn"), "Not signed in");
  assert.equal(coverStatusLabel({ kind: "none" }), "No cover yet");
  assert.equal(t("addBook.importBooksFound", { count: 1 }), "1 books found");
});

test("the import preview strings and the add-book cover status follow a Portuguese pick", () => {
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("addBook.importChooseFile"), "Escolher ficheiro da biblioteca");
    assert.equal(t("errors.requestFailed", { status: 413 }), "O pedido falhou (413)");
    assert.equal(t("addBook.importBooksFound", { count: 3 }), "3 livros encontrados");
    assert.equal(coverStatusLabel({ kind: "none" }), "Ainda sem capa");
    assert.equal(t("addBook.galleryDeleteWarning", { count: 2, murals: 3 }), "Ao eliminá-la, será removida de 2 livros e de 3 referências em murais.");
  } finally {
    setLocalePreference("auto");
  }
});
