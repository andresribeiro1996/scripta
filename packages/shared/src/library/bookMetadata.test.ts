import assert from "node:assert/strict";
import { test } from "node:test";
import { findOpenLibraryMatch, openLibraryDescription } from "./bookMetadata.js";

test("a description is read from either Open Library shape, and blank is none", () => {
  assert.equal(openLibraryDescription({ description: " *Dune* " }), "Dune");
  assert.equal(openLibraryDescription({ description: { value: "Dune" } }), "Dune");
  assert.equal(openLibraryDescription({ description: "  " }), null);
  assert.equal(openLibraryDescription({}), null);
});

test("a book without an ISBN still matches an Open Library doc whose text has mojibake or a marker inside a word", () => {
  const data = { docs: [
    { key: "/works/OL1W", title: "3\u0098ª\u009c classe de teste", author_name: ["Ana Co\u0098sta"] },
    { key: "/works/OL2W", title: "A fÃ© de teste", author_name: ["Rui FÃ©lix"] }
  ] };
  assert.equal(findOpenLibraryMatch(data, "", "3ª classe de teste", "Ana Costa")?.key, "/works/OL1W");
  assert.equal(findOpenLibraryMatch(data, "", "A fé de teste", "Rui Félix")?.key, "/works/OL2W");
});
