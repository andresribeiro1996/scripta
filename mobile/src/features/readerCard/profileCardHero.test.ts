import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardInputOf, renderReaderCard } from "@scripta/shared";
import { backdropXml } from "./backdropXml";

test("backdropXml wraps the card in a gaussian blur filter", () => {
  const svg = renderReaderCard({ ...readerCardInputOf([], [], "andre", "en"), print: "paper" });
  const xml = backdropXml(svg);
  assert.match(xml, /<feGaussianBlur stdDeviation="18"/);
  assert.ok(xml.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${/viewBox="([^"]+)"/.exec(svg)![1]}"`));
  assert.ok(xml.includes(svg));
});
