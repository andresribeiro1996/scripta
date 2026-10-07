import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";
import type { ReaderCardChosen } from "./style.js";

const signature = { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: "https://covers.example.org/earthsea.jpg", note: "the one I lend to everyone" };
const highlight = { text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" };
const card = (chosen: ReaderCardChosen): PublicReaderCard => ({ state: "settled", identity: "star", runnerUp: null, signal: null, coverage: [], chosen });
const page = (chosen: ReaderCardChosen, view: "owner" | "visitor" = "visitor") => renderReaderCard({ card: card(chosen), style: { counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", print: "paper", label: "Reader card", seed: seedOf("andre"), view } as ReaderCardInput, "chosen");
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!);

test("with both chosen, the page shows the book, its note, a divider and the highlight", () => {
  const svg = page({ signature, highlight });
  const all = texts(svg);
  for (const expected of ["SIGNATURE BOOK", "A Wizard of Earthsea", "URSULA K. LE GUIN", "“the one I lend to everyone”", "URSULA K. LE GUIN · A WIZARD OF EARTHSEA"]) assert.ok(all.includes(expected), expected);
  assert.ok(all.some((line) => line.startsWith("“To light a candle")));
  assert.equal(svg.match(/<image /g)?.length, 1);
  assert.match(svg, /href="https:\/\/covers\.example\.org\/earthsea\.jpg"/);
});

test("only a plain https cover becomes an image", () => {
  for (const coverUrl of ["http://covers.example.org/a.jpg", "javascript:alert(1)", "https://x.example/a\"onload=\"b", "https://x.example/a?b=1&c=2", null]) {
    const svg = page({ signature: { ...signature, coverUrl } });
    assert.doesNotMatch(svg, /<image/, String(coverUrl));
    assert.ok(texts(svg).includes("A WIZARD OF"), String(coverUrl));
  }
});

test("text is escaped once, and quotes stay as typed", () => {
  const svg = page({ highlight: { ...highlight, text: "He said \"<b>A & B</b>\"" } });
  assert.match(svg, /He said "&lt;b&gt;A &amp; B&lt;\/b&gt;"/);
  assert.doesNotMatch(svg, /<b>|&quot;/);
});

test("a long highlight stops at four lines, and a long title at two", () => {
  const long = page({ signature: { ...signature, title: "The Hitchhiker’s Guide to the Galaxy, The Restaurant at the End of the Universe, Life, the Universe and Everything" }, highlight: { ...highlight, text: "word ".repeat(80) } });
  const all = texts(long);
  const quote = all.findIndex((line) => line.startsWith("“word"));
  assert.ok(all[quote + 3]!.endsWith("…"));
  assert.ok(!all[quote + 4]!.startsWith("word"));
  assert.ok(!all.some((line) => line.includes("Everything")));
});

test("one choice takes the whole page", () => {
  const book = texts(page({ signature }));
  assert.ok(book.includes("SIGNATURE BOOK"));
  assert.ok(!book.some((line) => line.startsWith("“To light")));
  const quote = texts(page({ highlight }));
  assert.ok(!quote.includes("SIGNATURE BOOK"));
  assert.ok(quote.some((line) => line.startsWith("“To light")));
});

test("with nothing chosen the owner sees an invitation and a visitor sees an empty page", () => {
  assert.ok(texts(page({}, "owner")).includes("Pick a signature book and a"));
  assert.ok(!texts(page({}, "visitor")).includes("Pick a signature book and a"));
});

test("an annotation smuggled into the highlight is never drawn", () => {
  assert.doesNotMatch(page({ highlight: { ...highlight, annotation: "SECRET-NOTE" } as never }), /SECRET-NOTE/);
});
