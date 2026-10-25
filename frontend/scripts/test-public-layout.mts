import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PublicLayout } from "../src/layouts/PublicLayout";

Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

const render = (signedIn: boolean) => renderToString(createElement(MemoryRouter, null, createElement(PublicLayout, { signedIn })));

test("signed out: brand, a Log in link, no sidebar", () => {
  const html = render(false);
  assert.match(html, /<a(?=[^>]*href="\/login")[^>]*>Log in<\/a>/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /<aside/);
});

test("signed in: the right link opens the library", () => {
  assert.match(render(true), /<a(?=[^>]*href="\/dashboard")[^>]*>Open my library<\/a>/);
});
