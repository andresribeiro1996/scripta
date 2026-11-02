import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_READER_CARD_STYLE, publicStyle, readerCardInputOf, type PublicReaderCard } from "@scripta/shared";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

const { ProfileCardHero } = await import("../src/components/readerCard/ProfileCardHero");

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["genres known for 3 of 3 finished books"],
  dial: { segments: [{ group: "star", books: 3, marked: 1 }] },
  facts: { finished: 3, highlights: 2, series: 0, since: 2020, edition: 2026 },
  style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" },
};
const hero = (style: Partial<NonNullable<PublicReaderCard["style"]>> = {}) =>
  renderToString(createElement(ProfileCardHero, { input: readerCardInputOf([], [], "andre", "en", { ...card, style: { ...card.style!, ...style } }) }, createElement("p", null, "CHILD-MARKER")));

test("hero puts a blurred aria-hidden backdrop first and the card before its children", () => {
  const html = hero();
  const backdrop = html.match(/<div aria-hidden="true"[^>]*><img(?=[^>]*class="[^"]*\bblur-)[^>]*>/);
  assert.ok(backdrop);
  assert.match(backdrop[0], /src="data:image\/svg\+xml;utf8,/);
  assert.ok(html.indexOf(backdrop[0]) < html.indexOf("<svg"));
  assert.ok(html.indexOf("<svg") < html.indexOf("CHILD-MARKER"));
});

test("the backdrop is drawn from the card's own resolved print", () => {
  const paper = hero({ print: "paper" }).match(/<img[^>]*src="([^"]*)"/)![1]!;
  const reversed = hero({ print: "reversed" }).match(/<img[^>]*src="([^"]*)"/)![1]!;
  const auto = hero({ print: "auto" }).match(/<img[^>]*src="([^"]*)"/)![1]!;
  assert.notEqual(paper, reversed);
  assert.equal(auto, paper);
  assert.match(decodeURIComponent(reversed), /#efe5d1/);
  assert.doesNotMatch(decodeURIComponent(paper), /#efe5d1/);
});

test("children render inside the backdrop wrapper, not after it", () => {
  assert.match(hero(), /CHILD-MARKER<\/p><\/div><\/div>$/);
});
