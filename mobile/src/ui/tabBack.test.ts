import assert from "node:assert/strict";
import test from "node:test";
import { backGoesHome } from "./tabBack";

test("back on another tab's root goes home", () => {
  assert.equal(backGoesHome("(library)", 0), true);
  assert.equal(backGoesHome("(you)", 0), true);
});

test("back inside another tab's stack stays default", () => {
  assert.equal(backGoesHome("(library)", 1), false);
});

test("back on Home is always default", () => {
  assert.equal(backGoesHome("(home)", 0), false);
  assert.equal(backGoesHome("(home)", 2), false);
});
