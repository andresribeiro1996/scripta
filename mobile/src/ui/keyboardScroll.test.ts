import assert from "node:assert/strict";
import { test } from "node:test";
import { revealOffset } from "./keyboardScroll.js";

const view = { scrollY: 0, height: 400 };

test("a field already clear of the keyboard does not scroll", () => {
  assert.equal(revealOffset({ top: 100, height: 48 }, view, 16), null);
  assert.equal(revealOffset({ top: 0, height: 48 }, view, 16), null);
});

test("a field under the keyboard scrolls up far enough to leave the margin", () => {
  const offset = revealOffset({ top: 500, height: 48 }, view, 16);
  assert.equal(offset, 164);
  // 500 - 164 = 336 on screen, ending at 384 — 16px clear of the 400px edge.
  assert.equal(500 + 48 + 16 - offset!, view.height);
});

test("the second field of a form scrolls even when the keyboard is already up", () => {
  // Password sitting just below a username field that is itself the last thing
  // visible: the case where nothing re-fires the platform's own scroll.
  assert.equal(revealOffset({ top: 380, height: 48 }, { scrollY: 0, height: 390 }, 16), 54);
});

test("a field scrolled off the top comes back into view", () => {
  assert.equal(revealOffset({ top: 100, height: 48 }, { scrollY: 300, height: 400 }, 16), 84);
});

test("never scrolls past the top of the content", () => {
  assert.equal(revealOffset({ top: 8, height: 48 }, { scrollY: 200, height: 400 }, 16), 0);
});

test("a field taller than the space left over shows its top", () => {
  assert.equal(revealOffset({ top: 100, height: 500 }, view, 16), 84);
});
