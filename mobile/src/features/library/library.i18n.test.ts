import assert from "node:assert/strict";
import { test } from "node:test";
import { setLocalePreference, t } from "../../i18n";
import { parseLibraryJson } from "./lib/localImport";

test("the library screen strings stay English by default", () => {
  assert.equal(t("library.startTitle"), "Start your library");
  assert.equal(t("library.possibleDuplicates", { count: 1 }), "1 possible duplicate · Review");
  assert.equal(t("library.possibleDuplicates", { count: 3 }), "3 possible duplicates · Review");
  assert.equal(t("library.openGroup", { name: "Dune", type: "series", count: 2 }), "Open Dune, series, 2 books");
});

test("the library screen strings follow the Portuguese pick", () => {
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("library.startTitle"), "Comece a sua biblioteca");
    assert.equal(t("library.possibleDuplicates", { count: 1 }), "1 possível duplicado · Rever");
    assert.equal(t("library.possibleDuplicates", { count: 3 }), "3 possíveis duplicados · Rever");
    assert.equal(t("library.openGroup", { name: "Dune", type: t("library.groupTypeSeries").toLowerCase(), count: 2 }), "Abrir Dune, série, 2 livros");
    assert.equal(t("shell.showingType", { type: t("library.collections").toLowerCase() }), "A mostrar coleções");
    assert.throws(() => parseLibraryJson("{not json"), { message: "Esse ficheiro não é um JSON válido." });
  } finally {
    setLocalePreference("auto");
  }
});
