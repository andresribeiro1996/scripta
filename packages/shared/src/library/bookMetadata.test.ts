import assert from "node:assert/strict";
import { test } from "node:test";
import { openLibraryDescription, plainDescription } from "./bookMetadata.js";

test("Open Library markdown reads as plain text", () => {
  const raw = [
    "In this thrilling sequel to *A Game of Thrones*, **George R. R. Martin** returns.",
    "",
    "*A Clash of Kings*",
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
    "In this thrilling sequel to A Game of Thrones, George R. R. Martin returns.",
    "",
    "A Clash of Kings",
    "",
    "Preceded by: A Game of Thrones",
    "Followed by: A Storm of Swords",
    "",
    "(Source)"
  ].join("\n"));
});

test("the Fellowship's contents list and rule read as plain text", () => {
  const raw = [
    "Frodo Baggins, Bilbo's heir...and he is resolved to bear it to its end. Or his own.",
    "",
    "---",
    "",
    "Contains",
    "",
    "- The Fellowship of the Ring",
    "- [The Lord of the Rings \\[2/2\\]](https://openlibrary.org/works/OL27306128W)",
    "- [The Lord of the Rings \\[1/6\\]](https://openlibrary.org/works/OL24170898W)"
  ].join("\n");
  assert.equal(plainDescription(raw), [
    "Frodo Baggins, Bilbo's heir...and he is resolved to bear it to its end. Or his own.",
    "",
    "Contains",
    "",
    "- The Fellowship of the Ring",
    "- The Lord of the Rings [2/2]",
    "- The Lord of the Rings [1/6]"
  ].join("\n"));
});

test("asterisks only mark emphasis when they hug the words", () => {
  assert.equal(plainDescription("5 * 3 * 2 is *thirty*, **really**."), "5 * 3 * 2 is thirty, really.");
});

test("a description is read from either Open Library shape, and blank is none", () => {
  assert.equal(openLibraryDescription({ description: " *Dune* " }), "Dune");
  assert.equal(openLibraryDescription({ description: { value: "Dune" } }), "Dune");
  assert.equal(openLibraryDescription({ description: "  " }), null);
  assert.equal(openLibraryDescription({}), null);
});
