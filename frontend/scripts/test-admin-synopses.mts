import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { SynopsisReview } from "@scripta/shared";
import { AdminLinks } from "../src/components/AdminLinks";
import { SynopsisReviewList } from "../src/components/SynopsisReviewList";

const item = (hash: string, group: "hidden" | "doubtful", model: string, kind: string, usable: number) => ({ hash, title: `Title ${hash}`, author: "Author", coverUrl: null, editions: 2, works: 1, source: "publisher", text: "Praise for the author.", holders: 1, finished: true, group, model, kind, usable });
const review: SynopsisReview = {
  items: [item("r", "hidden", "rule", "fragment", 0), item("j", "hidden", "jev-1.13.0", "praise", 0.12), item("d", "doubtful", "jev-1.13.0", "author_bio", 0.41)],
  total: 3
};

const render = () => renderToString(createElement(SynopsisReviewList, { review, onDecide: async () => {} }));

test("each group shows its heading, count and evidence", () => {
  const html = render();
  for (const text of ["Hidden from readers (2)", "Shown, but doubtful (1)", "Rule: under 40 letters", "Jev: praise (0.12)", "Jev: author bio (0.41)", "2 editions", "Praise for the author."]) {
    assert.ok(html.includes(text), text);
  }
});

test("every row offers Keep and Hide", () => {
  const html = render();
  assert.equal(html.split(">Keep<").length - 1, 3);
  assert.equal(html.split(">Hide<").length - 1, 3);
});

test("the admin sees both review links, and nobody else sees any", () => {
  const links = (isAdmin: boolean) => renderToString(createElement(MemoryRouter, null, createElement(AdminLinks, { isAdmin })));
  assert.ok(links(true).includes('href="/admin/genres"'));
  assert.ok(links(true).includes('href="/admin/synopses"'));
  assert.equal(links(false), "");
});
