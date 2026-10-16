import assert from "node:assert/strict";
import { test } from "node:test";
import { genreEvidenceLabel, withoutWork } from "./genreReview.js";

test("each group's evidence reads as the review page shows it", () => {
  assert.equal(genreEvidenceLabel({ group: "rejected", status: 400, reason: "HTTP 400", attempts: 3, lastAt: "2026-10-15T00:00:00.000Z" }), "Rejected 3× · HTTP 400");
  assert.equal(genreEvidenceLabel({ group: "rejected", status: null, reason: "unexpected answer", attempts: 3, lastAt: "2026-10-15T00:00:00.000Z" }), "Rejected 3× · unexpected answer");
  assert.equal(genreEvidenceLabel({ group: "none", confidence: 0.91 }), "Jev: none (0.91)");
  assert.equal(genreEvidenceLabel({ group: "unsure", genre: "Poetry", confidence: 0.34 }), "Jev: Poetry? (0.34)");
  assert.equal(genreEvidenceLabel({ group: "possible", genre: "History", confidence: 0.62 }), "Possibly History (0.62)");
});

test("a resolved work leaves the review and the total", () => {
  const item = (workId: string) => ({ workId, title: workId, author: "A", coverUrl: null, synopsis: null, holders: 1, finished: false, evidence: { group: "none" as const, confidence: 0.9 } });
  const review = { items: [item("a"), item("b")], total: 7 };
  assert.deepEqual(withoutWork(review, "a"), { items: [item("b")], total: 6 });
  assert.equal(withoutWork(review, "missing"), review);
});
