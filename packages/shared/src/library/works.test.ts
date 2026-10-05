import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "./merge.js";
import { booksByWork, withWorkIds, workIdOf } from "./works.js";

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

test("booksByWork keeps the first book per work and skips books without one", () => {
  const first = { Title: "Orlando", ISBN: "9780156031516", _workId: "w1" };
  const second = { Title: "Orlando", _workId: "w1" };
  const other = { Title: "Emma", _workId: "w2" };
  const byWork = booksByWork([first, second, { Title: "Orphan" }, other]);
  assert.deepEqual([...byWork.keys()], ["w1", "w2"]);
  assert.equal(byWork.get("w1"), first);
  assert.equal(byWork.get("w2"), other);
});
