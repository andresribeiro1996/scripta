import assert from "node:assert/strict";
import { test } from "node:test";
import { CORNER_LABELS, FOOTER_LEFT_LABELS, FOOTER_RIGHT_LABELS, MOTTO_LOOK_LABELS, PRINT_LABELS } from "./labels.js";
import { CARD_PRINTS, CORNER_STYLES, DEFAULT_READER_CARD_STYLE, FOOTER_LEFTS, FOOTER_RIGHTS, MOTTO_LOOKS, draftSaver, noteToSend, normalizeReaderCardStyle, publicStyle, rekeyReaderCardStyle, resolvePrint } from "./style.js";

const PUBLIC_DEFAULTS = { motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto" };

test("the default style chooses no book, no highlight and no motto, and keeps today's footer, corners and print", () => {
  assert.deepEqual(DEFAULT_READER_CARD_STYLE, { counter: "dial", layout: "faces", trait: "both", ...PUBLIC_DEFAULTS, signature: null, highlight: null });
});

test("a signature needs a book key; its note is trimmed, capped at 60 and empty means none", () => {
  assert.equal(normalizeReaderCardStyle({ signature: { note: "x" } }).signature, null);
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "  why  " } }).signature, { bookKey: "k", note: "why" });
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "   " } }).signature, { bookKey: "k", note: null });
  assert.equal(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "a".repeat(80) } }).signature?.note?.length, 60);
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: 5 } }).signature, { bookKey: "k", note: null });
  assert.equal(normalizeReaderCardStyle({ signature: "k" }).signature, null);
});

test("a highlight needs both its book key and its id", () => {
  assert.equal(normalizeReaderCardStyle({ highlight: { bookKey: "k" } }).highlight, null);
  assert.deepEqual(normalizeReaderCardStyle({ highlight: { bookKey: "k", highlightId: "h" } }).highlight, { bookKey: "k", highlightId: "h" });
  assert.equal(normalizeReaderCardStyle({ highlight: ["h"] }).highlight, null);
});

test("the public style drops the private references", () => {
  const style = normalizeReaderCardStyle({ counter: "ring", signature: { bookKey: "k" }, highlight: { bookKey: "k", highlightId: "h" } });
  assert.deepEqual(publicStyle(style), { counter: "ring", layout: "faces", trait: "both", ...PUBLIC_DEFAULTS });
});

test("rekeying moves choices on merged books and leaves the rest", () => {
  const style = normalizeReaderCardStyle({ signature: { bookKey: "old" }, highlight: { bookKey: "other", highlightId: "h" } });
  const next = rekeyReaderCardStyle(style, ["old"], "kept");
  assert.equal(next.signature?.bookKey, "kept");
  assert.equal(next.highlight?.bookKey, "other");
  assert.equal(rekeyReaderCardStyle(DEFAULT_READER_CARD_STYLE, ["old"], "kept").signature, null);
});

test("rekeying keeps the same choice objects when no merged book is chosen", () => {
  const style = normalizeReaderCardStyle({ signature: { bookKey: "a" }, highlight: { bookKey: "b", highlightId: "h" } });
  const next = rekeyReaderCardStyle(style, ["old"], "kept");
  assert.equal(next.signature, style.signature);
  assert.equal(next.highlight, style.highlight);
});

test("a layout is kept when known and falls back to faces otherwise", () => {
  assert.equal(normalizeReaderCardStyle({ layout: "book" }).layout, "book");
  assert.equal(normalizeReaderCardStyle({ layout: "scroll" }).layout, "faces");
  assert.deepEqual(publicStyle(normalizeReaderCardStyle({ layout: "merged", signature: { bookKey: "k" } })), { counter: "dial", layout: "merged", trait: "both", ...PUBLIC_DEFAULTS });
});

test("a note is sent trimmed, cleared as null, and never twice in a row", () => {
  assert.equal(noteToSend("  lent twice ", null), "lent twice");
  assert.equal(noteToSend("   ", "lent twice"), null);
  assert.equal(noteToSend("lent twice", "lent twice"), undefined);
  assert.equal(noteToSend("", null), undefined);
});

test("the draft saver sends nothing for an unchanged value and null for whitespace", () => {
  const sent: (string | null)[] = [];
  const change = async (next: string | null) => { sent.push(next); return true; };
  const save = draftSaver("lent", () => {});
  save("lent", change);
  save("  fresh ", change);
  save("fresh", change);
  save("   ", change);
  assert.deepEqual(sent, ["fresh", null]);
});

test("a refused draft rolls the draft back only while it is unchanged, and the same text can be sent again", async () => {
  let draft = "lent";
  const results = [false, false];
  const sent: (string | null)[] = [];
  const change = async (next: string | null) => { sent.push(next); return results.shift()!; };
  const save = draftSaver(null, (failed, previous) => {
    if (draft === failed) draft = previous ?? "";
  });
  save("lent", change);
  draft = "lent twice";
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(draft, "lent twice");
  draft = "lent";
  save("lent", change);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 2);
  assert.equal(draft, "");
});

test("a motto is trimmed and capped at 28 characters, an empty one means none, and an unknown look becomes a ribbon", () => {
  assert.deepEqual(normalizeReaderCardStyle({ motto: { text: "  Per libros ad astra  ", look: "arc" } }).motto, { text: "Per libros ad astra", look: "arc" });
  assert.equal(normalizeReaderCardStyle({ motto: { text: "   ", look: "arc" } }).motto, null);
  assert.equal(normalizeReaderCardStyle({ motto: { text: "a".repeat(40), look: "rule" } }).motto?.text.length, 28);
  assert.equal([...normalizeReaderCardStyle({ motto: { text: "🦉".repeat(30), look: "rule" } }).motto!.text].length, 28);
  assert.deepEqual(normalizeReaderCardStyle({ motto: { text: "x", look: "neon" } }).motto, { text: "x", look: "ribbon" });
  assert.equal(normalizeReaderCardStyle({ motto: "x" }).motto, null);
  assert.equal(normalizeReaderCardStyle({ motto: { look: "arc" } }).motto, null);
});

test("each footer corner, the corners and the print fall back to their default on their own", () => {
  assert.deepEqual(normalizeReaderCardStyle({ footer: { left: "since", right: "neon" } }).footer, { left: "since", right: "name" });
  assert.deepEqual(normalizeReaderCardStyle({ footer: { left: 3, right: "handle" } }).footer, { left: "plate", right: "handle" });
  assert.deepEqual(normalizeReaderCardStyle({ footer: "x" }).footer, { left: "plate", right: "name" });
  assert.equal(normalizeReaderCardStyle({ corners: "laurel" }).corners, "laurel");
  assert.equal(normalizeReaderCardStyle({ corners: "neon" }).corners, "diamonds");
  assert.equal(normalizeReaderCardStyle({ print: "reversed" }).print, "reversed");
  assert.equal(normalizeReaderCardStyle({ print: "neon" }).print, "auto");
});

test("a style stored before A5 reads as the defaults for every new field", () => {
  const old = normalizeReaderCardStyle({ counter: "shelf", layout: "book", trait: "seal", signature: null, highlight: null });
  assert.deepEqual(old, { ...DEFAULT_READER_CARD_STYLE, counter: "shelf", layout: "book", trait: "seal" });
});

test("auto print follows the theme and a fixed print ignores it", () => {
  assert.equal(resolvePrint("auto", false), "paper");
  assert.equal(resolvePrint("auto", true), "reversed");
  assert.equal(resolvePrint("paper", true), "paper");
  assert.equal(resolvePrint("reversed", false), "reversed");
});

test("every decoration option has a name", () => {
  assert.deepEqual(MOTTO_LOOKS.map((key) => MOTTO_LOOK_LABELS[key]), ["Ribbon", "Scroll", "Arc", "Cartouche", "Rule", "Banner below", "Wavy ribbon", "Title rules", "Drop cap", "Sash", "Script", "Plaque"]);
  assert.deepEqual(FOOTER_LEFTS.map((key) => FOOTER_LEFT_LABELS[key]), ["Plate", "Plate and name", "Reader since", "Established", "Volumes", "Highlights", "Series", "Genre", "Edition", "Reader number", "Glyph", "None"]);
  assert.deepEqual(FOOTER_RIGHTS.map((key) => FOOTER_RIGHT_LABELS[key]), ["Name", "First name", "Last name", "First name, initial", "Initials", "Catalogue", "Handle", "Name in italics", "Signature", "Monogram", "Diamond monogram", "None"]);
  assert.deepEqual(CORNER_STYLES.map((key) => CORNER_LABELS[key]), ["Diamonds", "Art deco", "Fleuron", "Photo corners", "Stars", "Laurel", "Knot", "Volute", "Meander", "Rosette", "Register mark", "None"]);
  assert.deepEqual(CARD_PRINTS.map((key) => PRINT_LABELS[key]), ["Auto", "Light", "Dark"]);
});
