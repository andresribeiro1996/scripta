import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardInputOf, renderReaderCard } from "@scripta/shared";
import { backdropXml } from "./backdropXml";

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
