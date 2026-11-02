import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardGround, readerCardInputOf, renderReaderCard, type ReaderCardInput } from "@scripta/shared";
import { backdropXml, viewBlurSupported } from "./backdropXml";

const svg = renderReaderCard({ ...readerCardInputOf([], [], "andre", "en"), print: "paper" });

test("backdropXml slices the card to cover its box and leaves the blur to the view", () => {
  const xml = backdropXml(svg);
  assert.equal(xml.match(/<svg\b/g)!.length, 1);
  assert.match(xml.slice(0, xml.indexOf(">") + 1), /preserveAspectRatio="xMidYMid slice"/);
  assert.ok(!xml.includes("<filter"));
  assert.equal(xml.slice(xml.indexOf(">") + 1), svg.slice(svg.indexOf(">") + 1));
});

test("backdropXml replaces a preserveAspectRatio the card already has", () => {
  const xml = backdropXml(svg.replace("<svg ", '<svg preserveAspectRatio="none" '));
  assert.equal(xml.match(/preserveAspectRatio/g)!.length, 1);
  assert.match(xml, /preserveAspectRatio="xMidYMid slice"/);
});

test("the view blur is only trusted on Android 12 and later", () => {
  assert.equal(viewBlurSupported("android", 31), true);
  assert.equal(viewBlurSupported("android", 34), true);
  assert.equal(viewBlurSupported("android", 30), false);
  assert.equal(viewBlurSupported("ios", "17.0"), false);
  assert.equal(viewBlurSupported("web", 0), false);
});

test("the colour wash is the ground the card paints its first rect with", () => {
  const base = readerCardInputOf([], [], "andre", "en");
  for (const finish of ["paper", "aged", "kraft", "foil"] as const) {
    for (const print of ["paper", "reversed"] as const) {
      const input: ReaderCardInput = { ...base, print, style: { ...base.style, finish } };
      const first = /<rect style="fill:([^";]+)"/.exec(renderReaderCard(input))![1];
      assert.equal(readerCardGround(input), first, `${finish}/${print}`);
    }
  }
});
