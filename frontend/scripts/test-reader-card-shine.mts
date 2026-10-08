import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_READER_CARD_STYLE, readerCardInputOf, type Finish, type Layout } from "@scripta/shared";
import { ReaderCardTurner } from "../src/components/readerCard/ReaderCardTurner";

const books = Array.from({ length: 6 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, _genres: ["Fantasy"] }));
const turner = (finish: Finish, layout: Layout = "faces") => renderToString(createElement(ReaderCardTurner, { input: readerCardInputOf(books, [], "andre.ribeiro", undefined, { style: { ...DEFAULT_READER_CARD_STYLE, finish, layout }, coverOf: () => null }), cardWidth: "w-72", spreadWidth: "w-96" }));

test("foil, holo and gilt cards carry one shine, over the front face", () => {
  for (const finish of ["foil", "holo", "gilt"] as const) assert.equal(turner(finish).match(/card-shine-idle/g)?.length, 1, finish);
});

test("other finishes have no shine", () => {
  for (const finish of ["paper", "aged", "riso"] as const) assert.doesNotMatch(turner(finish), /card-shine/, finish);
});

test("the book pager shines its front page only", () => {
  assert.equal(turner("foil", "book").match(/card-shine-idle/g)?.length, 1);
});
