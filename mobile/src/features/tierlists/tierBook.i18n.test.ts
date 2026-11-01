/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { authorOf, labelOf, titleOf } from "./tierBook.js";

const dune = { Title: "Dune", Attribution: "Frank Herbert" };

test("tier book text is English by default", () => {
  assert.equal(titleOf({}, "en"), "Untitled");
  assert.equal(authorOf({ Title: "Dune" }, "en"), "Unknown author");
  assert.equal(labelOf(dune, "en"), "Dune by Frank Herbert");
});

test("tier book text follows the locale", () => {
  assert.equal(titleOf({}, "pt-PT"), "Sem título");
  assert.equal(authorOf({ Title: "Dune" }, "pt-PT"), "Autor desconhecido");
  assert.equal(labelOf(dune, "pt-PT"), "Dune, de Frank Herbert");
});
