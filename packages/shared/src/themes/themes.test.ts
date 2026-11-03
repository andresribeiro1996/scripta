import assert from "node:assert/strict";
import { test } from "node:test";
import { contrastRatio } from "../murals/blockTextColors.js";
import { muralColors } from "../murals/twins.js";
import { THEME_CONTRAST_PAIRS, THEME_IDS, themes } from "./palettes.js";
import { THEME_PREFERENCES, parseAccountAppearance, parseThemePreference, reconcileAppearance, resolveTheme } from "./preference.js";

for (const id of THEME_IDS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${id} (${scheme}): every text pairing reaches 4.5:1`, () => {
      const colors = muralColors(id, scheme);
      for (const [fg, bg] of THEME_CONTRAST_PAIRS) {
        const ratio = contrastRatio(colors[fg], colors[bg])!;
        assert.ok(ratio >= 4.5, `${id} (${scheme}) ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
      }
    });

    test(`${id} (${scheme}): accentFill separates from the page more than a border does`, () => {
      const colors = muralColors(id, scheme);
      assert.ok(contrastRatio(colors.accentFill, colors.background)! > contrastRatio(colors.border, colors.background)!);
    });

    test(`${id} (${scheme}): every colour except scrim is a lowercase six-digit hex`, () => {
      for (const [token, value] of Object.entries(muralColors(id, scheme))) {
        if (token === "scrim") assert.match(value, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, `${id} (${scheme}).scrim`);
        else assert.match(value, /^#[0-9a-f]{6}$/, `${id} (${scheme}).${token}`);
      }
    });
  }
}

test("exactly the designed themes use the dark scheme", () => {
  assert.deepEqual(
    THEME_IDS.filter((id) => themes[id].scheme === "dark"),
    ["dark", "midnight", "forest", "matrix", "synthwave", "seventies", "oxblood"],
  );
});

test("THEME_PREFERENCES is system followed by every theme id in picker order", () => {
  assert.deepEqual(THEME_PREFERENCES, ["system", ...THEME_IDS]);
});

test("parseThemePreference keeps valid values and turns anything else into system", () => {
  for (const value of THEME_PREFERENCES) assert.equal(parseThemePreference(value), value);
  for (const value of ["vaporwave", "", "Light", " dark", null, undefined, 3, {}]) assert.equal(parseThemePreference(value), "system");
});

test("resolveTheme follows the OS only for system", () => {
  assert.equal(resolveTheme("system", "light"), "light");
  assert.equal(resolveTheme("system", "dark"), "dark");
  assert.equal(resolveTheme("matrix", "light"), "matrix");
  assert.equal(resolveTheme("sepia", "dark"), "sepia");
});

test("reconcileAppearance uploads the device locale when the account has none and applies the account locale otherwise", () => {
  const base = { theme: "sepia", displayFont: "theme", textFont: "atkinson" } as const;
  assert.deepEqual(reconcileAppearance({ ...base, locale: null }, { ...base, locale: "en" }), { apply: {}, upload: { locale: "en" } });
  assert.deepEqual(reconcileAppearance({ ...base, locale: "pt-PT" }, { ...base, locale: "auto" }), { apply: { locale: "pt-PT" }, upload: {} });
  assert.deepEqual(reconcileAppearance({ ...base, locale: "auto" }, { ...base, locale: "auto" }), { apply: {}, upload: {} });
});

test("parseAccountAppearance reads locale, normalising unknown values to auto", () => {
  assert.equal(parseAccountAppearance({ locale: "pt-PT" }).locale, "pt-PT");
  assert.equal(parseAccountAppearance({ locale: "fr" }).locale, "auto");
  assert.equal(parseAccountAppearance({}).locale, null);
});
