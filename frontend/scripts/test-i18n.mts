import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogMismatches } from "@scripta/shared/i18n";

const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });
const { en } = await import("../src/i18n/messages/en/index.ts");
const { ptPT } = await import("../src/i18n/messages/pt-PT/index.ts");
const { getLocale, setDeviceLocaleTags, setLocalePreference, t } = await import("../src/i18n/index.ts");
const { LanguagePicker } = await import("../src/components/LanguagePicker.tsx");
const { publicFetch } = await import("../src/api/client.ts");

type Seen = { acceptLanguage: string | null };

async function limited(message: string): Promise<{ error: unknown; seen: Seen[] }> {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = async (_url, init) => {
    seen.push({ acceptLanguage: new Headers(init?.headers).get("Accept-Language") });
    return Response.json({ statusCode: 429, error: "Too Many Requests", message }, { status: 429 });
  };
  try {
    return { error: await publicFetch("/auth/login").catch((err: unknown) => err), seen };
  } finally {
    globalThis.fetch = original;
  }
}

test("the web catalog has no placeholder mismatches", () => {
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
  } finally {
    setLocalePreference("auto");
  }
  assert.equal(t("settings.language"), "Language");
});

test("the picker names both languages in either locale", () => {
  const html = renderToStaticMarkup(createElement(LanguagePicker));
  assert.match(html, /English/);
  assert.match(html, /Português/);
  setLocalePreference("pt-PT");
  try {
    const pt = renderToStaticMarkup(createElement(LanguagePicker));
    assert.match(pt, /Idioma/);
    assert.match(pt, /English/);
    assert.match(pt, /Português/);
  } finally {
    setLocalePreference("auto");
  }
});

test("a rate limit reads the same in English and is Portuguese on request", async () => {
  const english = await limited("Rate limit exceeded, retry in 2 minutes");
  assert.equal((english.error as Error).message, "Too many tries. Wait 2 minutes and try again.");
  assert.equal(english.seen[0]!.acceptLanguage, "en");
  setLocalePreference("pt-PT");
  try {
    const portuguese = await limited("Rate limit exceeded, retry in 2 minutes");
    assert.equal((portuguese.error as Error).message, "Demasiadas tentativas. Aguarde 2 minutos e tente novamente.");
    assert.equal(portuguese.seen[0]!.acceptLanguage, "pt-PT");
    assert.equal(((await limited("Rate limit exceeded, retry in 1 hour")).error as Error).message, "Demasiadas tentativas. Aguarde 1 hora e tente novamente.");
    assert.equal(((await limited("nope")).error as Error).message, "Demasiadas tentativas. Aguarde um minuto e tente novamente.");
  } finally {
    setLocalePreference("auto");
  }
});
