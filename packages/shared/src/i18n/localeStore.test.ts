import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocaleStore } from "./localeStore.js";

test("an explicit preference beats the device tags", () => {
  const store = createLocaleStore(true);
  store.setDeviceLocaleTags(["en-GB"]);
  store.setLocalePreference("pt-PT");
  assert.equal(store.getLocale(), "pt-PT");
});

test("Portuguese off resolves to English", () => {
  const store = createLocaleStore(false);
  store.setLocalePreference("pt-PT");
  assert.equal(store.getLocale(), "en");
});

test("subscribers hear changes", () => {
  const store = createLocaleStore(true);
  let calls = 0;
  const unsubscribe = store.subscribeLocale(() => { calls += 1; });
  store.setLocalePreference("pt-PT");
  store.setDeviceLocaleTags(["en"]);
  assert.equal(calls, 2);
  unsubscribe();
  store.setLocalePreference("en");
  assert.equal(calls, 2);
});

test("auto preference with Portuguese device tags stays English", () => {
  const store = createLocaleStore(true);
  store.setDeviceLocaleTags(["pt-PT"]);
  assert.equal(store.getLocalePreference(), "auto");
  assert.equal(store.getLocale(), "en");
});

test("two stores do not share state", () => {
  const a = createLocaleStore(true);
  const b = createLocaleStore(true);
  a.setLocalePreference("pt-PT");
  assert.equal(a.getLocale(), "pt-PT");
  assert.equal(b.getLocalePreference(), "auto");
  assert.equal(b.getLocale(), "en");
});
