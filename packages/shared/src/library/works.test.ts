import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "./merge.js";
import { withWorkIds, workIdOf } from "./works.js";

test("withWorkIds tags each book with its work and leaves workless books alone", () => {
  const dune = { Title: "Dune", Attribution: "Frank Herbert" };
  const orlando = { Title: "Orlando", Attribution: "Virginia Woolf" };
  const [tagged, untouched] = withWorkIds([dune, orlando], { "ta:dune|frank herbert": "w-dune" });
  assert.equal(workIdOf(tagged!), "w-dune");
  assert.equal(untouched, orlando);
  assert.equal(workIdOf(untouched!), undefined);
  assert.equal("_workId" in dune, false);
  assert.deepEqual(withWorkIds([dune], undefined), [dune]);
});

test("bookKey honours a server key carried on a public book", () => {
  assert.equal(bookKey({ Title: "Orlando", Attribution: "Unknown author", _key: "ta:orlando|" }), "ta:orlando|");
});
