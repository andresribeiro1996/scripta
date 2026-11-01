import assert from "node:assert/strict";
import { test } from "node:test";
import { setLocalePreference, t } from "../../i18n";
import { DISCOVER_FILTERS, renderableActivity } from "./communityHome";

test("the community strings stay English by default", () => {
  assert.equal(t("community.yourReadingCircle"), "Your reading circle");
  assert.equal(t("community.seeAllIn", { count: 8, noun: "books", name: "Autumn cup" }), "See all 8 books in Autumn cup");
  assert.equal(t(DISCOVER_FILTERS[1].labelKey), "Tier lists");
});

test("the community strings follow the Portuguese pick", () => {
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("community.yourReadingCircle"), "O seu círculo de leitura");
    assert.equal(t("shell.showingType", { type: t(DISCOVER_FILTERS[1].labelKey).toLowerCase() }), "A mostrar tabelas de níveis");
    assert.equal(t("community.publishShelfBody", { username: "ana" }), "Passa a ser uma página pública em /u/ana com a sua biblioteca, e os leitores podem encontrar e seguir o seu perfil.");
    assert.deepEqual(renderableActivity([], "pt-PT"), []);
  } finally {
    setLocalePreference("auto");
  }
});
