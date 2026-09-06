import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMuralPreset, MURAL_PRESETS } from "../src/lib/muralPresets.ts";
import { isValidBlockLayout } from "../src/lib/murals.ts";
import { bookKey } from "../src/lib/merge.ts";

const books = [
  { Title: "Old favourite", Attribution: "A", ReadStatus: 2, Rating: 5, DateLastRead: "2025-01-01" },
  { Title: "Recent", Attribution: "A", ReadStatus: 2, Rating: 4, DateLastRead: "2026-09-01" },
  { Title: "Undated", Attribution: "A", ReadStatus: 2 },
  { Title: "Next", Attribution: "A", ReadStatus: 0, DateCreated: "2026-09-01" },
  { Title: "Reading", Attribution: "A", ReadStatus: 1 }
];

test("presets preserve valid freeform layouts with empty and populated libraries", () => {
  for (const preset of MURAL_PRESETS) for (const library of [[], books]) {
    const result = buildMuralPreset(preset.id, library);
    assert.ok(result.blocks.every((block) => isValidBlockLayout(block.layout, result.blocks, block.id)));
    assert.equal(new Set(result.blocks.map((block) => block.id)).size, result.blocks.length);
    assert.notEqual(result.blocks[0].id, buildMuralPreset(preset.id, library).blocks[0].id);
  }
});

test("selection uses personal ratings and imported reading dates without inventing data", () => {
  const best = buildMuralPreset("best", books);
  const hero = best.blocks.find((block) => block.type === "spotlight");
  assert.equal(hero?.type === "spotlight" && hero.bookKey, bookKey(books[0]));
  assert.equal(best.bookCount, 2);
  const recent = buildMuralPreset("recent", [...books, books[1]]);
  const shelf = recent.blocks.find((block) => block.type === "shelf");
  assert.deepEqual(shelf?.type === "shelf" && shelf.bookKeys, [books[1], books[0], books[2]].map(bookKey));
  assert.equal(buildMuralPreset("next", books).bookCount, 1);
  assert.equal(buildMuralPreset("best", [{ Title: "Unrated", ReadStatus: 2 }]).bookCount, 0);
  assert.equal(buildMuralPreset("next", [{ Title: "Unknown status" }]).bookCount, 0);
});
