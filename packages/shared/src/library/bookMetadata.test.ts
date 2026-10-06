import assert from "node:assert/strict";
import { test } from "node:test";
import { openLibraryDescription, plainDescription } from "./bookMetadata.js";

test("Open Library markdown reads as plain text", () => {
  const raw = [
    "In this sequel to *A Game of Thrones*, **George R. R. Martin** returns.",
    "",
    "Preceded by: [*A Game of Thrones*][1]",
    "Followed by: [A Storm of Swords](https://openlibrary.org/works/OL257914W)",
    "",
    "([Source][2])",
    "",
    "[1]: https://openlibrary.org/works/OL257943W",
    "[2]: https://georgerrmartin.com/grrm_book/a-clash-of-kings/"
  ].join("\n");
  assert.equal(plainDescription(raw), [
    "In this sequel to A Game of Thrones, George R. R. Martin returns.",
    "",
    "Preceded by: A Game of Thrones",
    "Followed by: A Storm of Swords",
    "",
    "(Source)"
  ].join("\n"));
});

test("a description is read from either Open Library shape, and blank is none", () => {
  assert.equal(openLibraryDescription({ description: " *Dune* " }), "Dune");
  assert.equal(openLibraryDescription({ description: { value: "Dune" } }), "Dune");
  assert.equal(openLibraryDescription({ description: "  " }), null);
  assert.equal(openLibraryDescription({}), null);
});
