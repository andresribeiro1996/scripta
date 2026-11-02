import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardInputOf, renderReaderCard } from "@scripta/shared";
import { backdropXml } from "./backdropXml";

const svg = renderReaderCard({ ...readerCardInputOf([], [], "andre", "en"), print: "paper" });

test("backdropXml keeps one root svg and blurs then saturates the card's own content", () => {
  const xml = backdropXml(svg, 12.5);
  assert.equal(xml.match(/<svg\b/g)!.length, 1);
  assert.equal(xml.match(/<\/svg>/g)!.length, 1);
  assert.match(xml, /<feGaussianBlur stdDeviation="12\.5"\/><feColorMatrix type="saturate" values="1\.4"\/>/);
  assert.ok(!xml.includes("scale("));
  assert.match(xml, /<g filter="url\(#backdropBlur\)">/);
  assert.ok(xml.includes(/viewBox="[^"]+"/.exec(svg)![0]));
  assert.match(xml.slice(0, xml.indexOf(">") + 1), /preserveAspectRatio="xMidYMid slice"/);
  assert.match(xml, /<\/g>\s*<\/svg>\s*$/);
});

test("backdropXml replaces a preserveAspectRatio the card already has", () => {
  const xml = backdropXml(svg.replace("<svg ", '<svg preserveAspectRatio="none" '), 12.5);
  assert.equal(xml.match(/preserveAspectRatio/g)!.length, 1);
  assert.match(xml, /preserveAspectRatio="xMidYMid slice"/);
});
