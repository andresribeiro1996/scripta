import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const { TopBar } = await import("../src/components/page/TopBar");
const { accountMenuItems } = await import("../src/components/page/AccountMenu");
const { TOP_BAR_AREAS } = await import("../src/lib/areas");

Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

const bar = (props: Partial<Parameters<typeof TopBar>[0]> = {}) => renderToString(createElement(MemoryRouter, null,
  createElement(TopBar, { areas: TOP_BAR_AREAS, activeId: "library", brandTo: "/dashboard", end: createElement("span", null, "END"), ...props })));

test("a 64px bar, sticky from lg, skip link first, then the brand", () => {
  const html = bar();
  assert.match(html, /<header(?=[^>]*data-top-bar)(?=[^>]*lg:sticky lg:top-0)[^>]*>/);
  assert.match(html, /h-16/);
  assert.match(html, /^<header[^>]*><a href="#content"[^>]*sr-only[^>]*focus:not-sr-only[^>]*>Skip to content<\/a>/);
  assert.match(html, /href="\/dashboard"/);
});

test("six areas as 44px pills, the current one marked", () => {
  const html = bar();
  const nav = html.match(/<nav aria-label="Main"[\s\S]*?<\/nav>/)![0];
  assert.equal(nav.match(/<a(?=[^>]*min-h-11)(?=[^>]*rounded-full)[^>]*>/g)?.length, 6);
  assert.doesNotMatch(nav, /Settings|Admin/);
  assert.match(nav, /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/dashboard\/library")[^>]*>/);
  assert.equal(nav.match(/aria-current="page"/g)?.length, 1);
});

test("the Home badge keeps its label", () => {
  assert.match(bar({ homeBadge: "3" }), /aria-label="Home, 3 new"/);
});

test("desktop-only hides below lg; the public bar has no area nav", () => {
  assert.match(bar({ desktopOnly: true }), /<header[^>]*hidden lg:block/);
  assert.doesNotMatch(bar(), /<header[^>]*hidden lg:block/);
  assert.doesNotMatch(bar({ areas: [], brandTo: "/" }), /aria-label="Main"/);
  assert.match(bar(), /END/);
});

test("account menu: shelf, settings, admin only for admins, log out last and danger", () => {
  const items = (isAdmin: boolean) => accountMenuItems({ username: "ana", isAdmin, navigate: () => {}, logout: () => {} });
  assert.deepEqual(items(false).map((i) => i.label), ["My shelf", "Settings", "Log out"]);
  assert.deepEqual(items(true).map((i) => i.label), ["My shelf", "Settings", "Admin", "Log out"]);
  assert.equal(items(true).at(-1)!.danger, true);
  const went: string[] = [];
  accountMenuItems({ username: "ana", isAdmin: true, navigate: (to) => went.push(to), logout: () => {} }).slice(0, 3).forEach((i) => i.onClick());
  assert.deepEqual(went, ["/community/u/ana", "/dashboard/settings", "/admin/genres"]);
});

test("the account trigger is named, and a long username truncates in the menu heading", () => {
  const menu = readFileSync(new URL("../src/components/OptionsMenu.tsx", import.meta.url), "utf8");
  assert.match(menu, /className="w-0 min-w-full truncate[^"]*">\{heading\}/);
  assert.match(readFileSync(new URL("../src/components/page/AccountMenu.tsx", import.meta.url), "utf8"), /title="Account menu"/);
});

test("the desktop sidebar is gone and pinned elements sit under the bar", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  const layout = read("layouts/DashboardLayout");
  assert.doesNotMatch(layout, /<aside className="hidden/);
  assert.match(layout, /<main id="content"/);
  assert.match(layout, /pathname === `\/community\/u\/\$\{/);
  for (const f of ["components/OfflineBanner", "components/SwipeTabs", "pages/MuralEditorPage", "pages/SharedMuralPage"]) {
    assert.doesNotMatch(read(f), /sticky top-0/, f);
    assert.match(read(f), /sticky top-\(--app-top\)/, f);
  }
  assert.doesNotMatch(read("components/Toolbar"), /sticky top-0/);
  assert.match(read("components/Toolbar"), /sticky top-\[calc\(var\(--app-top\)\+var\(--offline-h,0px\)\)\]/);
  assert.match(read("components/OfflineBanner"), /--offline-h/);
  assert.match(read("pages/ReaderCardPage"), /lg:top-\[calc\(var\(--app-top\)\+1\.5rem\)\]/);
  assert.match(read("components/book/BookScreen"), /lg:top-\[calc\(var\(--app-top\)\+1\.5rem\)\]/);
});

test("SwipeTabs reveals its top against the sticky offset, not against zero", () => {
  const swipe = readFileSync(new URL("../src/components/SwipeTabs.tsx", import.meta.url), "utf8");
  assert.match(swipe, /anchor\.getBoundingClientRect\(\)\.top < parseFloat\(getComputedStyle\(tablist\)\.top\)/);
  assert.doesNotMatch(swipe, /getBoundingClientRect\(\)\.top < 0/);
});

test("a fullscreen mural covers the bar, so its pinned header sticks at the top of the overlay", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  for (const f of ["pages/MuralEditorPage", "pages/SharedMuralPage"]) assert.match(read(f), /fixed inset-0 z-50 [^"]*\[--app-top:0px\]/, f);
});
