import assert from "node:assert/strict";
import { test } from "node:test";
import { fitLine, fitSize, textWidth, wrapLines } from "./fit.js";

const body = { font: "serif", size: 11, width: 190 } as const;

test("width is characters times the font's average plus letter spacing", () => {
  assert.equal(textWidth("ABC", { font: "caps", size: 10, spacing: 2 }), 3 * 0.68 * 10 + 2 * 2);
  assert.equal(textWidth("", { font: "mono", size: 7 }), 0);
});

test("a line that fits is returned whole", () => {
  assert.equal(fitLine("A Wizard of Earthsea", body), "A Wizard of Earthsea");
});

test("a line that overflows ends in an ellipsis inside the width", () => {
  const line = fitLine("x".repeat(80), body);
  assert.ok(line.endsWith("…"));
  assert.ok(textWidth(line, body) <= body.width);
});

test("wrapping fills lines word by word and never exceeds the width", () => {
  const lines = wrapLines("No one would have believed in the last years of the nineteenth century that this world was being watched", { ...body, lines: 4 });
  assert.ok(lines.length >= 2 && lines.length <= 4);
  for (const line of lines) assert.ok(textWidth(line, body) <= body.width, line);
});

test("text longer than its lines ends the last line in an ellipsis", () => {
  const lines = wrapLines("word ".repeat(200), { ...body, lines: 4 });
  assert.equal(lines.length, 4);
  assert.ok(lines[3]!.endsWith("…"));
  assert.ok(!lines[2]!.endsWith("…"));
});

test("a sixty-character note fits two lines without an ellipsis", () => {
  const lines = wrapLines("the book I lend to everyone and never get back again, twice", { font: "serif", size: 7.5, width: 190, lines: 2 });
  assert.equal(lines.length, 2);
  assert.ok(!lines.join("").includes("…"));
});

test("one overlong word is cut, and blank text gives no lines", () => {
  const lines = wrapLines("Supercalifragilistic".repeat(10), { ...body, lines: 2 });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.endsWith("…"));
  assert.deepEqual(wrapLines("   ", { ...body, lines: 2 }), []);
});

test("fitSize keeps a size that fits and shrinks one that does not, never below the minimum", () => {
  assert.equal(fitSize("Per libros", { font: "serif", size: 8, width: 100, min: 5 }), 8);
  const shrunk = fitSize("W".repeat(28), { font: "serif", size: 8, width: 100, spacing: 0.6, min: 5 });
  assert.ok(shrunk < 8 && shrunk >= 5, String(shrunk));
  assert.ok(textWidth("W".repeat(28), { font: "serif", size: shrunk, spacing: 0.6 }) <= 100);
  assert.equal(fitLine("W".repeat(28), { font: "serif", size: shrunk, width: 100, spacing: 0.6 }), "W".repeat(28));
  assert.equal(fitSize("W".repeat(200), { font: "serif", size: 8, width: 100, min: 5 }), 5);
});

test("script text is estimated narrower than the serif", () => {
  assert.ok(textWidth("Andre Ribeiro", { font: "script", size: 12 }) < textWidth("Andre Ribeiro", { font: "serif", size: 12 }));
});
