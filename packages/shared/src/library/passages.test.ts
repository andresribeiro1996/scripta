import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "./merge.js";
import { PASSAGE_MATCH_LIMIT, bookLabel, bookPassages, searchPassages } from "./passages.js";

const mark = (id: string, text: string, type = "highlight") => ({ Type: type, Text: text, BookmarkID: id });
const earthsea = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [mark("h1", "  To light a candle is to cast a shadow.  "), mark("h2", "a note", "note"), mark("h3", "   "), { Type: "highlight", Text: "no id" }] };
const dune = { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1, highlights: [mark("d1", "Fear is the mind-killer."), mark("d2", "The candle and the sand.")] };

test("a book's passages are its real Kobo highlights, trimmed, with the book's title and author", () => {
  assert.deepEqual(bookPassages(earthsea), [{ bookKey: bookKey(earthsea), highlightId: "h1", text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" }]);
  assert.deepEqual(bookPassages({ Title: "No marks" }), []);
});

test("a book with no title or author is labelled the way the public card labels it", () => {
  assert.deepEqual(bookLabel({ Title: "  " }), { title: "Untitled", author: "Unknown author" });
});

test("search matches passage text across every book, ignoring case, and blank finds nothing", () => {
  assert.deepEqual(searchPassages([earthsea, dune], "CANDLE").map((passage) => passage.highlightId), ["h1", "d2"]);
  assert.deepEqual(searchPassages([earthsea, dune], "herbert"), []);
  assert.deepEqual(searchPassages([earthsea, dune], "   "), []);
});

test("search stops at the match limit", () => {
  const many = { Title: "Many", highlights: Array.from({ length: PASSAGE_MATCH_LIMIT + 5 }, (_, i) => mark(`m${i}`, `word ${i}`)) };
  assert.equal(searchPassages([many], "word").length, PASSAGE_MATCH_LIMIT);
});
