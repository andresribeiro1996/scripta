import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutLabels, printLabels, traitLabels } from "@scripta/shared";
import { setLocalePreference, t } from "../../i18n";
import { layoutOptions, printOptions, traitOptions } from "./segmentOptions";

test("the English segmented labels equal the shared English labels", () => {
  for (const [options, labels] of [[traitOptions("en"), traitLabels("en")], [printOptions("en"), printLabels("en")], [layoutOptions("en"), layoutLabels("en")]] as const) {
    for (const option of options) assert.equal(option.label, (labels as Record<string, string>)[option.value], option.value);
  }
});

test("the Portuguese segmented labels are short enough for a 320dp row", () => {
  assert.deepEqual(traitOptions("pt-PT").map((option) => option.label), ["Ambos", "Selo", "Linha", "Sem"]);
  assert.deepEqual(printOptions("pt-PT").map((option) => option.label), ["Auto", "Claro", "Escuro"]);
  assert.deepEqual(layoutOptions("pt-PT").map((option) => option.label), ["Virar", "Livro", "Um verso"]);
});

test("the editor's strings follow the pick", () => {
  assert.equal(t("readerCard.yourStreak"), "Your streak");
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("readerCard.yourStreak"), "A sua sequência");
  } finally {
    setLocalePreference("auto");
  }
});
