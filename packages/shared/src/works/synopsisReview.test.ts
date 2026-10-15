import assert from "node:assert/strict";
import { test } from "node:test";
import { synopsisEvidenceLabel, withoutSynopsis, type SynopsisReview } from "./synopsisReview.js";

test("the evidence names the rule, or Jev's kind and probability", () => {
  assert.equal(synopsisEvidenceLabel({ model: "rule", kind: "fragment", usable: 0 }), "Rule: under 40 letters");
  assert.equal(synopsisEvidenceLabel({ model: "jev-1.13.0", kind: "praise", usable: 0.123 }), "Jev: praise (0.12)");
  assert.equal(synopsisEvidenceLabel({ model: "jev-1.13.0", kind: "author_bio", usable: 0.41 }), "Jev: author bio (0.41)");
});

test("withoutSynopsis drops one item and the total, and leaves an unknown hash alone", () => {
  const item = (hash: string) => ({ hash, title: "T", author: "A", coverUrl: null, editions: 1, works: 1, source: "publisher", text: "x", holders: 0, finished: false, group: "hidden" as const, model: "rule", kind: "fragment", usable: 0 });
  const review: SynopsisReview = { items: [item("a"), item("b")], total: 5 };
  assert.deepEqual(withoutSynopsis(review, "a"), { items: [item("b")], total: 4 });
  assert.equal(withoutSynopsis(review, "z"), review);
});
