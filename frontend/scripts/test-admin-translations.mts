import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { TranslationReview } from "@scripta/shared";
import { area, footerAreas } from "../src/lib/areas";
import { TranslationReviewList } from "../src/components/TranslationReviewList";

const item = (workId: string, group: "possible" | "blocked" | "merged", model: string, confidence: number | null) => ({
  workId, title: `Livro ${workId}`, author: "Autor", originalTitle: "Book", coverUrl: null, synopsis: "Uma sinopse.", holders: 1, finished: false,
  proposed: { workId: `o-${workId}`, title: `Book ${workId}`, author: "Author", year: 1927, editions: 3, languages: ["en"] },
  group, evidence: { model, confidence }, mergedAt: group === "merged" ? "2026-10-15T12:00:00.000Z" : null
});
const review: TranslationReview = { items: [item("p", "possible", "jev-1.13.0", 0.74), item("b", "blocked", "code", null), item("m", "merged", "jev-1.13.0", 0.95)], total: 3 };
const render = () => renderToString(createElement(TranslationReviewList, { review, onDecide: async () => {} }));

test("each group shows both sides and its evidence", () => {
  const html = render();
  for (const text of ["Possible translations (1)", "Blocked by an arena (1)", "Merged automatically (1)", "Livro p", "Book p", "Jev 0.74", "Both in an arena · Code: original title + author surname", "Jev 0.95", "1927", "3 editions"]) {
    assert.ok(html.includes(text), text);
  }
});

test("possible rows offer Merge and Not a translation, blocked rows only the second, merged rows Undo", () => {
  const html = render();
  assert.equal(html.split(">Merge<").length - 1, 1);
  assert.equal(html.split(">Not a translation<").length - 1, 2);
  assert.equal(html.split(">Undo<").length - 1, 1);
});

test("the admin sees the translation review link", () => {
  assert.equal(footerAreas(true)[0]?.id, "admin");
  assert.ok(area("admin").tabs.some((t) => t.to === "/admin/translations"));
  assert.deepEqual(footerAreas(false), []);
});
