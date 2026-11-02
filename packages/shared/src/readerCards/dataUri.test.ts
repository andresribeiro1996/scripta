import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardInputOf } from "../library/readerCardFacts.js";
import { readerCardDataUri } from "./dataUri.js";
import { renderReaderCard } from "./render.js";

const PREFIX = "data:image/svg+xml;utf8,";

test("readerCardDataUri round-trips the rendered svg", () => {
  const input = { ...readerCardInputOf([], [], "andre", "en"), print: "paper" as const };
  const uri = readerCardDataUri(input);
  assert.ok(uri.startsWith(PREFIX));
  assert.equal(decodeURIComponent(uri.slice(PREFIX.length)), renderReaderCard(input, "front"));
  assert.equal(decodeURIComponent(readerCardDataUri(input, "record").slice(PREFIX.length)), renderReaderCard(input, "record"));
});
