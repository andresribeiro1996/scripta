import assert from "node:assert/strict";
import { test } from "node:test";
import { hasChosen, readerCardPages, startTurn, turnBy, turnTo, turnToPage } from "./pages.js";

test("faces turn front, chosen, record, and a visitor with nothing chosen skips the chosen page", () => {
  assert.deepEqual(readerCardPages("faces", "visitor", true), ["front", "chosen", "record"]);
  assert.deepEqual(readerCardPages("faces", "visitor", false), ["front", "record"]);
  assert.deepEqual(readerCardPages("faces", "owner", false), ["front", "chosen", "record"]);
});

test("a book opens onto a spread, and merged has a single back", () => {
  assert.deepEqual(readerCardPages("book", "owner", false), ["front", ["chosen", "record"]]);
  assert.deepEqual(readerCardPages("book", "visitor", true), ["front", ["chosen", "record"]]);
  assert.deepEqual(readerCardPages("book", "visitor", false), ["front", "record"]);
  assert.deepEqual(readerCardPages("merged", "visitor", false), ["front", "merged"]);
});

test("something is chosen when there is a signature or a highlight", () => {
  assert.equal(hasChosen(undefined), false);
  assert.equal(hasChosen({}), false);
  assert.equal(hasChosen({ highlight: { text: "t", title: "b", author: "a" } }), true);
});

test("turning forward wraps and puts the new page on the face that comes round", () => {
  let state = startTurn(3);
  assert.deepEqual(state, { index: 0, rotation: 0, faces: [0, 1] });
  state = turnBy(state, 1, 3);
  assert.deepEqual(state, { index: 1, rotation: 180, faces: [0, 1] });
  state = turnBy(state, 1, 3);
  assert.deepEqual(state, { index: 2, rotation: 360, faces: [2, 1] });
  state = turnBy(state, 1, 3);
  assert.deepEqual(state, { index: 0, rotation: 540, faces: [2, 0] });
});

test("turning back rotates the other way, and turning to the current page does nothing", () => {
  let state = turnBy(startTurn(3), -1, 3);
  assert.deepEqual(state, { index: 2, rotation: -180, faces: [0, 2] });
  assert.equal(turnTo(state, 2, 1), state);
  state = turnTo(state, 0, -1);
  assert.deepEqual(state, { index: 0, rotation: -360, faces: [0, 2] });
});

test("a single page never turns", () => {
  const state = startTurn(1);
  assert.deepEqual(state.faces, [0, 0]);
  assert.equal(turnBy(state, 1, 1), state);
});

test("turning to a page lands on its first index, else the merged back, else the second page", () => {
  const flat = (layout: "faces" | "book" | "merged", view: "owner" | "visitor", chosen: boolean) => readerCardPages(layout, view, chosen).flat();
  const at = (pages: ReturnType<typeof flat>, page: "front" | "chosen" | "record" | "merged") => turnToPage(startTurn(pages.length), pages, page).index;
  const faces = flat("faces", "owner", false);
  assert.deepEqual([at(faces, "front"), at(faces, "chosen"), at(faces, "record"), at(faces, "merged")], [0, 1, 2, 1]);
  const book = flat("book", "owner", true);
  assert.deepEqual([at(book, "front"), at(book, "chosen"), at(book, "record")], [0, 1, 2]);
  const merged = flat("merged", "owner", false);
  assert.deepEqual([at(merged, "front"), at(merged, "chosen"), at(merged, "record"), at(merged, "merged")], [0, 1, 1, 1]);
  const bare = flat("faces", "visitor", false);
  assert.deepEqual([at(bare, "front"), at(bare, "chosen"), at(bare, "record")], [0, 1, 1]);
  const shown = flat("faces", "visitor", true);
  assert.equal(at(shown, "chosen"), 1);
});

test("turning to a page keeps the turn state consistent in both directions", () => {
  const pages = readerCardPages("faces", "owner", true).flat();
  const forward = turnToPage(startTurn(3), pages, "record");
  assert.deepEqual(forward, { index: 2, rotation: 180, faces: [0, 2] });
  const back = turnToPage(forward, pages, "front");
  assert.deepEqual(back, { index: 0, rotation: 0, faces: [0, 2] });
  assert.equal(turnToPage(back, pages, "front"), back);
});
