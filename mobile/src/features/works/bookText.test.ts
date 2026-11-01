import assert from "node:assert/strict";
import { test } from "node:test";
import { setLocalePreference, t } from "../../i18n";

test("the book screen's row labels and genre chips follow the language", () => {
  assert.equal(t("book.characterCount", { count: 1 }), "1 character");
  assert.equal(t("book.characterCount", { count: 3 }), "3 characters");
  assert.equal(t("book.possibleGenre", { genre: "History" }), "Possibly History");
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("book.characterCount", { count: 1 }), "1 personagem");
    assert.equal(t("book.characterCount", { count: 3 }), "3 personagens");
    assert.equal(t("book.possibleGenre", { genre: "História" }), "Possivelmente História");
    assert.equal(t("book.byAuthor", { author: "Frank Herbert" }), "de Frank Herbert");
  } finally {
    setLocalePreference("auto");
  }
});
