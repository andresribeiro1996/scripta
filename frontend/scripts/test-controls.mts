import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");

test("menus open on three dots, not a sun glyph", () => {
  assert.match(src("components/OptionsMenu"), /MoreIcon/);
  assert.doesNotMatch(src("components/OptionsMenu"), /<circle cx="12" cy="12" r="3/);
});

test("menu rows are 44px targets", () => {
  assert.match(src("components/OptionsMenu"), /min-h-11[^"]*text-left/);
});

test("the bare-ring GearIcon is gone", () => {
  assert.doesNotMatch(src("components/Toolbar"), /GearIcon/);
  for (const f of ["pages/GroupsPage", "components/LibraryToolbar"]) assert.doesNotMatch(src(f), /GearIcon/, f);
});

test("Settings' Change buttons and fields meet the 44px floor and carry labels", () => {
  const s = src("pages/SettingsPage");
  assert.doesNotMatch(s, /text-xs[^"]*"[^>]*>\s*Change/);
  assert.match(s, /<label[^>]*htmlFor=/);
  assert.match(s, /min-h-11[^"]*"\s*>\s*Change/);
});

test("Style and Cover chips and Home activity rows are 44px targets", () => {
  const card = src("components/BookCard");
  assert.equal(card.match(/flex min-h-11 min-w-11 items-center justify-center/g)?.length, 2);
  assert.match(src("pages/HomePage"), /<Link to=\{digestTarget\(item\)\} className="flex min-h-11/);
});

test("the mural editor and seed page have one accent each", () => {
  for (const f of ["pages/MuralEditorPage", "pages/ArenaSeedPage"]) {
    const s = src(f);
    assert.doesNotMatch(s, /bg-\(--color-accent\)/, f);
    assert.match(s, /min-h-11[^"]*items-center[^"]*text-left/, f);
  }
});
