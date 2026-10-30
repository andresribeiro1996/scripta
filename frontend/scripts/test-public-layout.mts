import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { BUTTON_SECONDARY } from "../src/components/page/buttonClasses";
import { PublicLayout } from "../src/layouts/PublicLayout";

Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

const render = (signedIn: boolean) => renderToString(createElement(MemoryRouter, null, createElement(PublicLayout, { signedIn })));

test("signed out: the bar with brand, Log in and no area nav", () => {
  const html = render(false);
  assert.match(html, /<header(?=[^>]*data-top-bar)/);
  assert.doesNotMatch(html, /<header[^>]*hidden lg:block/);
  assert.match(html, /<a(?=[^>]*href="\/")(?=[^>]*aria-label="Atmyshelf home")[^>]*>/);
  assert.match(html, /<a(?=[^>]*href="\/login")[^>]*>Log in<\/a>/);
  assert.ok(html.includes(`class="${BUTTON_SECONDARY}"`));
  assert.doesNotMatch(html, /aria-label="Main"/);
  assert.doesNotMatch(html, /<aside/);
  assert.match(html, /<main id="content"/);
});

test("signed in without a username: Open my library", () => {
  const html = render(true);
  assert.match(html, /<a(?=[^>]*href="\/dashboard")[^>]*>Open my library<\/a>/);
  assert.ok(html.includes(`class="${BUTTON_SECONDARY}"`));
});

test("share, vote, play and daily pages use the session frame; public /arena stays public", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const session = app.slice(app.indexOf("<Route element={<SessionLayout />}>"), app.indexOf("<Route element={<RequireAuth />}>"));
  for (const path of ["/shared/murals/:token", "/shared/library/:token", "/vote/:code", "/play/:code", "/daily"]) assert.match(session, new RegExp(`path="${path}"`), path);
  const publicBlock = app.slice(app.indexOf("<Route element={<PublicRoutesLayout />}>"));
  assert.match(publicBlock, /path="\/arena"/);
  assert.doesNotMatch(publicBlock, /path="\/(shared\/|vote\/|play\/|daily")/);
});

test("the vote page hides the phone bottom bar while its pool dock shows, under either frame", () => {
  const vote = readFileSync(new URL("../src/pages/VoteTierlistPage.tsx", import.meta.url), "utf8");
  assert.match(vote, /useOutletContext<\{ setNavHidden\?: \(hidden: boolean\) => void \} \| undefined>\(\)/);
  assert.match(vote, /setNavHidden\?\.\(true\)/);
  assert.match(vote, /setNavHidden\?\.\(false\)/);
  assert.match(vote, /<HideBottomNav \/>\s*<TierBoard\b/);
});
