import assert from "node:assert/strict";
import { test } from "node:test";
import { translationEvidenceLabel, withoutTranslation, type TranslationReview } from "./translationReview.js";

test("the evidence names code, Jev's confidence, or the arena", () => {
  assert.equal(translationEvidenceLabel({ group: "merged", evidence: { model: "code", confidence: null } }), "Code: original title + author surname");
  assert.equal(translationEvidenceLabel({ group: "possible", evidence: { model: "jev-1.13.0", confidence: 0.741 } }), "Jev 0.74");
  assert.equal(translationEvidenceLabel({ group: "blocked", evidence: { model: "jev-1.13.0", confidence: 0.95 } }), "Both in an arena · Jev 0.95");
});

test("withoutTranslation drops one item and the total", () => {
  const item = (workId: string) => ({ workId, title: "T", author: "A", originalTitle: null, coverUrl: null, synopsis: null, holders: 0, finished: false, proposed: { workId: "o", title: "O", author: "A", year: null, editions: 1, languages: [] }, group: "possible" as const, evidence: { model: "jev-1.13.0", confidence: 0.6 }, mergedAt: null });
  const review: TranslationReview = { items: [item("a"), item("b")], total: 2 };
  assert.deepEqual(withoutTranslation(review, "a"), { items: [item("b")], total: 1 });
  assert.equal(withoutTranslation(review, "z"), review);
});
