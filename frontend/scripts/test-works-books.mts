import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "@scripta/shared";
import { booksByWork } from "../src/lib/booksByWork.ts";
import { buildReconstructedBooks, toPrivateBook } from "../src/lib/sharedMural.ts";
import type { PublicBookData } from "../src/api/sharedMurals.ts";

test("booksByWork keeps the first book per work and skips books without one", () => {
  const first = { Title: "Orlando", ISBN: "9780156031516", _workId: "w1" };
  const second = { Title: "Orlando", _workId: "w1" };
  const other = { Title: "Emma", _workId: "w2" };
  const orphan = { Title: "Orphan" };
  const byWork = booksByWork([first, second, orphan, other]);
  assert.deepEqual([...byWork.keys()], ["w1", "w2"]);
  assert.equal(byWork.get("w1"), first);
  assert.equal(byWork.get("w2"), other);
});

const pub = (overrides: Partial<PublicBookData>): PublicBookData => ({
  key: "isbn:9780156031516",
  workId: "w1",
  title: "Orlando",
  author: "Virginia Woolf",
  isbn: "9780156031516",
  imageId: null,
  coverUrl: null,
  readStatus: 0,
  ...overrides
});

test("public books keep the server's key and carry their work id", () => {
  const keyed = pub({});
  const keyless = pub({ key: "ta:orlando|", workId: null, isbn: null, author: "Unknown author" });
  for (const book of [keyed, keyless]) assert.equal(bookKey(toPrivateBook(book)), book.key);
  assert.equal(toPrivateBook(keyed)._workId, "w1");
  assert.equal("_workId" in toPrivateBook(keyless), false);

  const rebuilt = buildReconstructedBooks([keyed, keyless], [keyed], []);
  assert.deepEqual(rebuilt.map(bookKey), ["isbn:9780156031516", "ta:orlando|"]);
  assert.equal(rebuilt[0]!._workId, "w1");
});
