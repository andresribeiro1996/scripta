/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { BORDER_SIDE_PRESETS, COLOR_LOOKS, CORNER_PRESETS, FRAME_LOOKS, borderStyleChoices, presetOptions } from "./blockStyleOptions.js";
import { setLocalePreference, t } from "../../i18n";

test("style presets keep their English labels", () => {
  assert.deepEqual(presetOptions(CORNER_PRESETS, "en").map((preset) => preset.label), ["Square", "Slight", "Rounded", "Round"]);
  assert.deepEqual(presetOptions(BORDER_SIDE_PRESETS, "en").map((preset) => preset.label), ["All", "Top & bottom", "Left & right", "Bottom only", "Left only"]);
  assert.deepEqual(borderStyleChoices("en").map((choice) => choice.label), ["Solid", "Dashed", "Dotted"]);
  assert.deepEqual(FRAME_LOOKS.map((look) => t(look.labelKey)), ["Card", "Framed", "Flat", "Outline", "Bookplate", "Margin note"]);
  assert.equal(t(COLOR_LOOKS[5]!.labelKey), "Note");
});

test("style presets follow the locale", () => {
  assert.deepEqual(presetOptions(CORNER_PRESETS, "pt-PT").map((preset) => preset.label), ["Quadrado", "Ligeiro", "Arredondado", "Redondo"]);
  assert.deepEqual(borderStyleChoices("pt-PT").map((choice) => choice.value), ["solid", "dashed", "dotted"]);
  setLocalePreference("pt-PT");
  try {
    assert.equal(t(FRAME_LOOKS[5]!.labelKey), "Nota de margem");
  } finally {
    setLocalePreference("auto");
  }
});
