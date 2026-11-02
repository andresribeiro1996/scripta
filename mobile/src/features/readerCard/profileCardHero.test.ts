import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { readerCardInputOf, renderReaderCard } from "@scripta/shared";

const source = readFileSync("src/features/readerCard/ProfileCardHero.tsx", "utf8");
const declaration = /export function backdropXml[\s\S]*?\n}\n/.exec(source)![0].replace("export ", "");
const backdropXml = new Function(`${stripTypeScriptTypes(declaration)}\nreturn backdropXml;`)() as (svg: string) => string;

test("backdropXml wraps the card in a gaussian blur filter", () => {
  const svg = renderReaderCard({ ...readerCardInputOf([], [], "andre", "en"), print: "paper" });
  const xml = backdropXml(svg);
  assert.match(xml, /<feGaussianBlur stdDeviation="18"/);
  assert.ok(xml.includes(/viewBox="[^"]+"/.exec(svg)![0]));
  assert.ok(xml.includes(svg));
});
