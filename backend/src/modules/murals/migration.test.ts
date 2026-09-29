import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "murals-migration-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.MURALS_DB_PATH = join(scratch, "murals.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.NODE_ENV = "test";

const { resetPresetBlockStyles } = await import("./migration.js");
const { DEFAULT_BLOCK_STYLE } = await import("@scripta/shared");

const UPDATED_AT = "2026-09-01T00:00:00.000Z";
const presetChrome = { cardBorderWidth: 0, cardShadow: false, cardRadius: 16 };
const baseStyle = { ...DEFAULT_BLOCK_STYLE, ...presetChrome, backgroundColor: "#2b2622", textColor: "#f5f1e9" };
const accentStyle = { ...DEFAULT_BLOCK_STYLE, ...presetChrome, backgroundColor: "#e6c79c", textColor: "#2b2622", fontFamily: "playfairDisplay" };

function muralsDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  return db;
}

function seed(db: DatabaseSync, id: string, blocks: unknown) {
  db.prepare("INSERT INTO murals (id, user_id, name, blocks, created_at, updated_at) VALUES (?, 'u1', 'Mural', ?, ?, ?)")
    .run(id, typeof blocks === "string" ? blocks : JSON.stringify(blocks), UPDATED_AT, UPDATED_AT);
}

function row(db: DatabaseSync, id: string) {
  return db.prepare("SELECT blocks, updated_at FROM murals WHERE id = ?").get(id) as { blocks: string; updated_at: string };
}

test("stored preset base and accent blocks go back to the theme card", () => {
  const db = muralsDb();
  seed(db, "m1", [
    { id: "a", type: "text", heading: "Hi", body: "", layout: { x: 0, y: 0, w: 12, h: 3 }, style: accentStyle },
    { id: "b", type: "shelf", title: "Shelf", bookKeys: ["k"], layout: { x: 0, y: 3, w: 12, h: 5 }, style: baseStyle }
  ]);
  resetPresetBlockStyles(db);
  const [accent, base] = JSON.parse(row(db, "m1").blocks);
  assert.deepEqual(accent.style, { ...DEFAULT_BLOCK_STYLE, fontFamily: "playfairDisplay" });
  assert.deepEqual(base.style, DEFAULT_BLOCK_STYLE);
  assert.equal(base.title, "Shelf");
  assert.deepEqual(base.bookKeys, ["k"]);
  assert.deepEqual(base.layout, { x: 0, y: 3, w: 12, h: 5 });
});

test("colours the user picked are never touched, even next to a preset colour", () => {
  const db = muralsDb();
  const userPicked = JSON.stringify([
    { id: "a", type: "empty", layout: { x: 0, y: 0, w: 4, h: 4 }, style: { ...baseStyle, backgroundColor: "#123456" } },
    { id: "b", type: "empty", layout: { x: 4, y: 0, w: 4, h: 4 }, style: { ...baseStyle, textColor: "#ffffff" } },
    { id: "c", type: "empty", layout: { x: 8, y: 0, w: 4, h: 4 }, style: { ...DEFAULT_BLOCK_STYLE, backgroundColor: "#2b2622" } },
    { id: "d", type: "empty", layout: { x: 0, y: 4, w: 4, h: 4 } },
    { id: "e", type: "empty", layout: { x: 4, y: 4, w: 4, h: 4 }, style: { ...baseStyle, backgroundColor: "#e6c79c", textColor: "#f5f1e9" } }
  ]);
  seed(db, "m1", userPicked);
  resetPresetBlockStyles(db);
  assert.equal(row(db, "m1").blocks, userPicked);
});

test("a matched block keeps chrome it no longer shares with the preset, and matching ignores case", () => {
  const db = muralsDb();
  seed(db, "m1", [{ id: "a", type: "empty", layout: { x: 0, y: 0, w: 4, h: 4 }, style: { ...baseStyle, backgroundColor: "#2B2622", textColor: "#F5F1E9", cardRadius: 24, cardShadow: true, fontFamily: "serif", bold: true } }]);
  resetPresetBlockStyles(db);
  const [block] = JSON.parse(row(db, "m1").blocks);
  assert.deepEqual(block.style, { ...DEFAULT_BLOCK_STYLE, cardRadius: 24, fontFamily: "serif", bold: true });
});

test("running twice changes nothing more, and updated_at is never touched", () => {
  const db = muralsDb();
  seed(db, "m1", [{ id: "a", type: "empty", layout: { x: 0, y: 0, w: 4, h: 4 }, style: baseStyle }]);
  resetPresetBlockStyles(db);
  const once = row(db, "m1");
  resetPresetBlockStyles(db);
  assert.deepEqual(row(db, "m1"), once);
  assert.equal(once.updated_at, UPDATED_AT);
  assert.notEqual(once.blocks, JSON.stringify([{ id: "a", type: "empty", layout: { x: 0, y: 0, w: 4, h: 4 }, style: baseStyle }]));
});

test("rows with nothing to reset are not rewritten", () => {
  const db = muralsDb();
  const untouched = '[ {"id":"a","type":"empty","layout":{"x":0,"y":0,"w":4,"h":4}} ]';
  seed(db, "m1", untouched);
  seed(db, "m2", '{"not":"an array"}');
  resetPresetBlockStyles(db);
  assert.equal(row(db, "m1").blocks, untouched);
  assert.equal(row(db, "m2").blocks, '{"not":"an array"}');
});

test("a row with malformed blocks JSON fails the whole run and rolls back earlier rewrites", () => {
  const db = muralsDb();
  const before = JSON.stringify([{ id: "a", type: "empty", layout: { x: 0, y: 0, w: 4, h: 4 }, style: baseStyle }]);
  seed(db, "m1", before);
  seed(db, "m2", "{not json");
  assert.throws(() => resetPresetBlockStyles(db), SyntaxError);
  assert.equal(row(db, "m1").blocks, before);
});
