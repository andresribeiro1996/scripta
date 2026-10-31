import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogMismatches } from "./catalogCheck.js";
import { en } from "./messages/en.js";
import { ptPT } from "./messages/pt-PT.js";
import { sharedT } from "./sharedT.js";
import { parseAcceptLanguage, parseLocalePreference, resolveLocale } from "./locale.js";
import { createTranslator } from "./translate.js";

test("an explicit pick beats the device", () => {
  assert.equal(resolveLocale("en", ["pt-PT"]), "en");
  assert.equal(resolveLocale("pt-PT", ["en-GB"]), "pt-PT");
});

test("any Portuguese first tag resolves to pt-PT", () => {
  for (const tag of ["pt", "pt-PT", "pt-BR", "pt_PT", "PT-br"]) {
    assert.equal(resolveLocale("auto", [tag]), "pt-PT");
    assert.equal(resolveLocale(null, [tag]), "pt-PT");
  }
  assert.equal(resolveLocale("auto", ["ptx"]), "en");
});

test("only the first device tag counts and nothing means English", () => {
  assert.equal(resolveLocale("auto", ["en-PT", "pt-PT"]), "en");
  assert.equal(resolveLocale(undefined, []), "en");
});

test("parseLocalePreference falls back to auto", () => {
  assert.equal(parseLocalePreference("pt-PT"), "pt-PT");
  assert.equal(parseLocalePreference("fr"), "auto");
  assert.equal(parseLocalePreference(undefined), "auto");
});

test("parseAcceptLanguage orders by q and drops malformed parts", () => {
  assert.deepEqual(parseAcceptLanguage("en;q=0.5, pt-PT"), ["pt-PT", "en"]);
  assert.deepEqual(parseAcceptLanguage("en, fr;q=x, !!, de;q=0.9"), ["en", "de"]);
  assert.deepEqual(parseAcceptLanguage(undefined), []);
});

test("createTranslator interpolates and pluralises", () => {
  const t = createTranslator({
    greet: "Olá {name}",
    readers: { one: "{count} leitor", other: "{count} leitores" },
  });
  assert.equal(t("greet", { name: "Ana" }), "Olá Ana");
  assert.equal(t("readers", { count: 0 }), "0 leitores");
  assert.equal(t("readers", { count: 1 }), "1 leitor");
  assert.equal(t("readers", { count: 2 }), "2 leitores");
  assert.equal(t("readers", { count: 1000 }), "1000 leitores");
  assert.throws(() => t("readers"));
});

test("catalogMismatches finds every kind of drift", () => {
  const en = { a: "Hi {name}", b: { one: "{count} x", other: "{count} xs" }, c: "C" };
  assert.deepEqual(
    catalogMismatches(en, { a: "Olá {name}", b: { one: "{count} x", other: "{count} xs" }, c: "C" }),
    [],
  );
  assert.equal(catalogMismatches(en, { a: "Olá {nome}", b: "x", d: "D" }).length, 4);
});

test("the shared catalog has no mismatches", () => {
  assert.deepEqual(catalogMismatches(en, ptPT), []);
});

test("sharedT answers in the requested language", () => {
  assert.equal(sharedT("en")("shared.helpers.today"), "Today");
  assert.equal(sharedT("pt-PT")("shared.helpers.today"), "Hoje");
  assert.equal(sharedT("pt-PT")("shared.helpers.books", { count: 1 }), "1 livro");
  assert.equal(sharedT("pt-PT")("shared.helpers.books", { count: 2 }), "2 livros");
});
