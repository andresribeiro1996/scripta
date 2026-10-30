import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUTTON_DANGER, BUTTON_DANGER_OUTLINE, FIELD_CLASS, chipClass } from "../src/components/page/buttonClasses";
import { CARD, LIST_PANEL, LIST_ROW_LINK, PANEL_HEADING, SECTION_HEADING } from "../src/components/page/surfaceClasses";

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
  assert.equal(card.match(/flex min-h-11 min-w-11 items-start justify-center/g)?.length, 2);
  assert.match(src("pages/HomePage"), /<Link to=\{digestTarget\(item\)\} className="flex min-h-11/);
});

test("the mural editor and seed page have one accent each", () => {
  for (const f of ["pages/MuralEditorPage", "pages/ArenaSeedPage"]) {
    const s = src(f);
    assert.doesNotMatch(s, /bg-\(--color-accent\)/, f);
    assert.match(s, /min-h-11[^"]*items-center[^"]*text-left/, f);
  }
});

test("danger buttons meet the floor and pair danger with on-danger", () => {
  assert.match(BUTTON_DANGER, /min-h-11/);
  assert.match(BUTTON_DANGER, /bg-\(--color-danger\)/);
  assert.match(BUTTON_DANGER, /text-\(--color-on-danger\)/);
  assert.match(BUTTON_DANGER_OUTLINE, /border-\(--color-danger\)[^"]*text-\(--color-danger\)|text-\(--color-danger\)[^"]*border-\(--color-danger\)/);
});

test("one field class: 44px, 16px text, accent focus, danger when invalid", () => {
  for (const cls of [/min-h-11/, /text-base/, /rounded-lg/, /border-\(--color-border\)/, /bg-\(--color-surface\)/, /focus:border-\(--color-accent\)/, /aria-invalid:border-\(--color-danger\)/]) assert.match(FIELD_CLASS, cls);
});

test("filter chips: 44px pills, inverted ink when selected", () => {
  assert.match(chipClass(true), /min-h-11[^"]*rounded-full|rounded-full[^"]*min-h-11/);
  assert.match(chipClass(true), /bg-\(--color-text\)[^"]*text-\(--color-bg\)/);
  assert.match(chipClass(false), /bg-\(--color-surface\)/);
  assert.match(chipClass(false), /border-\(--color-border\)/);
});

test("lists are one panel with divided rows, headings have two styles", () => {
  assert.match(LIST_PANEL, /divide-y divide-\(--color-border\)/);
  assert.match(LIST_ROW_LINK, /min-h-11/);
  assert.match(SECTION_HEADING, /font-display/);
  assert.match(PANEL_HEADING, /font-text/);
  assert.match(CARD, /rounded-2xl/);
  assert.doesNotMatch(CARD, /rounded-xl/);
});

test("no hand-rolled danger fills and no toolbar field class", () => {
  for (const f of ["components/ConfirmDialog", "auth/DeleteAccountSection", "pages/LibraryPage", "pages/GroupsPage", "components/OwnShelfView"]) assert.doesNotMatch(src(f), /bg-\(--color-danger\)/, f);
  assert.doesNotMatch(src("components/Toolbar"), /TOOLBAR_CONTROL_CLASS/);
});

test("layout variables: sticky offset, scroll padding, cover shadow in both schemes, solid bar for reduced transparency", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(css, /--app-top:\s*0(px)?/);
  assert.match(css, /min-width:\s*64rem[\s\S]*?--app-top:\s*4rem/);
  assert.match(css, /scroll-padding-top:\s*var\(--app-top\)/);
  assert.equal(css.match(/--shadow-cover:/g)?.length, 2);
  assert.match(css, /prefers-reduced-transparency:\s*reduce[\s\S]*?\[data-top-bar\]/);
});
