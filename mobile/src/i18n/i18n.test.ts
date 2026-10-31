import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogMismatches } from "@scripta/shared/i18n";
import { reconcileAppearance, type AccountAppearance } from "@scripta/shared/themes";
import { en } from "./messages/en";
import { ptPT } from "./messages/pt-PT";
import { getLocale, getLocalePreference, setDeviceLocaleTags, setLocalePreference, t } from "./index";

test("the mobile catalog has no placeholder mismatches", () => {
  assert.deepEqual(catalogMismatches(en, ptPT), []);
});

test("English is the default, and a Portuguese device alone does not change it before launch", () => {
  assert.equal(getLocale(), "en");
  setDeviceLocaleTags(["pt-PT"]);
  try {
    assert.equal(getLocale(), "en");
  } finally {
    setDeviceLocaleTags([]);
  }
});

test("an explicit pt-PT pick switches t()", () => {
  setLocalePreference("pt-PT");
  try {
    assert.equal(getLocale(), "pt-PT");
    assert.equal(t("settings.language"), "Idioma");
    assert.equal(t("errors.requestFailed", { status: 502 }), "O pedido falhou (502)");
  } finally {
    setLocalePreference("auto");
  }
  assert.equal(t("settings.language"), "Language");
});

test("a locale from the account is applied to the device pick and the device pick is what gets reconciled", () => {
  const account: AccountAppearance = { theme: null, displayFont: null, textFont: null, locale: "pt-PT" };
  const device = { theme: "system", displayFont: "theme", textFont: "theme", locale: getLocalePreference() } as const;
  const { apply, upload } = reconcileAppearance(account, device);
  assert.equal(apply.locale, "pt-PT");
  assert.equal(upload.locale, undefined);
  setLocalePreference(apply.locale!);
  try {
    assert.equal(getLocalePreference(), "pt-PT");
    assert.deepEqual(reconcileAppearance({ ...account, locale: null }, { ...device, locale: getLocalePreference() }).upload, { theme: "system", displayFont: "theme", textFont: "theme", locale: "pt-PT" });
  } finally {
    setLocalePreference("auto");
  }
});
