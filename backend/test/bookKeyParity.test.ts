// Guards a duplication that cannot be removed and must not drift.
//
// `bookKey()` exists twice: in frontend/src/lib/merge.ts (which computes
// it when merging imports and when building group/mural references) and
// in backend .../domain/document.ts (which computes it when decomposing a
// document into rows). It has to exist on both sides — the frontend needs
// it offline while parsing an import, the backend needs it to key the
// books table — and the two must agree byte-for-byte. Groups and mural
// blocks reference books by this string, so a divergence would silently
// orphan every one of those references, with no error anywhere.
//
// Rather than compare source text (brittle), this runs BOTH real
// implementations over the same corpus.

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

import { bookKey as backendBookKey } from "../src/modules/library/domain/document.js";

// Loaded at runtime rather than statically imported. The frontend is a
// separate package using bundler module resolution (extensionless relative
// imports); pulling it into this package's NodeNext program would drag
// those resolution rules in with it. tsx resolves it fine at run time,
// which is all this test needs.
type BookKeyFn = (book: Record<string, unknown>) => string;
let frontendBookKey: BookKeyFn;

const here = dirname(fileURLToPath(import.meta.url));

/** Deliberately includes the awkward cases: ISBN-10 with an X check
 *  digit, hyphenated and spaced ISBNs, a 12-digit near-miss that must NOT
 *  be treated as an ISBN, missing/blank/non-string fields, unicode, and
 *  whitespace that normalisation has to collapse identically on both
 *  sides. */
const CORPUS: Array<Record<string, unknown>> = [
  { ISBN: "9780441013593", Title: "Dune", Attribution: "Frank Herbert" },
  { ISBN: "978-0-441-01359-3", Title: "Dune", Attribution: "Frank Herbert" },
  { ISBN: "978 0 441 01359 3", Title: "Dune", Attribution: "Frank Herbert" },
  { ISBN: "043942089X", Title: "Harry Potter", Attribution: "J. K. Rowling" },
  { ISBN: "043942089x", Title: "Harry Potter", Attribution: "J. K. Rowling" },
  { ISBN: "123456789012", Title: "Twelve digits is not an ISBN", Attribution: "X" },
  { ISBN: "", Title: "Blank ISBN", Attribution: "Y" },
  { ISBN: null, Title: "Null ISBN", Attribution: "Y" },
  { ISBN: undefined, Title: "Undefined ISBN", Attribution: "Y" },
  { ISBN: 9780441013593, Title: "Numeric ISBN", Attribution: "Z" },
  { Title: "  Leading and   internal   spaces  ", Attribution: "  A.   Writer " },
  { Title: "MiXeD CaSe TiTlE", Attribution: "MiXeD AuThOr" },
  { Title: "Ünïcödé Títlé", Attribution: "Áuthør Nâme" },
  { Title: "", Attribution: "" },
  {},
  { Title: 42, Attribution: true },
  { Title: "Tabs\tand\nnewlines", Attribution: "Multi\nline" },
  { Title: "Pipe | in title", Attribution: "Pipe | in author" },
  { ISBN: "  9780441013593  ", Title: "Padded ISBN", Attribution: "P" }
];

describe("bookKey parity between frontend and backend", () => {
  before(async () => {
    const mergePath = join(here, "../../frontend/src/lib/merge.ts");
    const frontend = (await import(mergePath)) as { bookKey: BookKeyFn };
    frontendBookKey = frontend.bookKey;
  });

  it("agrees on every record in the corpus", () => {
    for (const record of CORPUS) {
      assert.equal(
        backendBookKey(record),
        frontendBookKey(record),
        `bookKey diverged for ${JSON.stringify(record)} — groups and mural blocks reference books by this string, so a mismatch silently orphans them`
      );
    }
  });

  it("still produces the keys the stored data already uses", () => {
    // Belt to the braces above: if BOTH sides were changed together, the
    // parity test would still pass while every existing group and mural
    // reference broke. These are the two shapes actually written to
    // group_books.book_key and mural_blocks' JSON today.
    assert.equal(backendBookKey({ ISBN: "9780441013593" }), "isbn:9780441013593");
    assert.equal(backendBookKey({ Title: "Some Indie Book", Attribution: "A. Writer" }), "ta:some indie book|a. writer");
  });
});
