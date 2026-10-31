import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const { SidebarNav } = await import("../src/components/page/SidebarNav");
const { NAV_AREAS, footerAreas } = await import("../src/lib/areas");

const nav = (props: Parameters<typeof SidebarNav>[0]) => renderToString(createElement(MemoryRouter, null, createElement(SidebarNav, props)));

test("lists the areas as 44px links and marks the active one", () => {
  const html = nav({ areas: NAV_AREAS, activeId: "library" });
  assert.equal(html.match(/<a(?=[^>]*min-h-11)[^>]*>/g)?.length, 7);
  assert.match(html, /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/dashboard\/library")[^>]*>/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.doesNotMatch(html, /Admin/);
});

test("the Home badge and its label survive", () => {
  const html = nav({ areas: NAV_AREAS, activeId: null, homeBadge: "3" });
  assert.match(html, /aria-label="Home, 3 new"/);
});

test("the footer Admin link is a 44px link to the review queues", () => {
  assert.match(nav({ areas: footerAreas(true), activeId: null }), /<a(?=[^>]*href="\/admin\/daily-chapter")(?=[^>]*min-h-11)[^>]*>[\s\S]*?Admin/);
  assert.equal(nav({ areas: footerAreas(false), activeId: null }).includes("/admin/"), false);
});
