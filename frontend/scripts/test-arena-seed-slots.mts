import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeedBook } from "../src/api/arena";
import { createSeededTournament, hasTournamentName, slotPayload, UNTITLED_TOURNAMENT } from "../src/lib/arenaSeed";

const book = (workId: string): SeedBook => ({ workId, title: workId, author: "A", cover: null });

test("slot payload keeps each book at its own slot when an earlier slot is emptied", () => {
  const [a, b, c, d] = ["A", "B", "C", "D"].map(book);
  const afterRemovingB = [a, b, c, d].map((entry, index) => (index === 1 ? null : entry));
  assert.deepEqual(slotPayload(afterRemovingB), [
    { slotIndex: 0, book: a },
    { slotIndex: 2, book: c },
    { slotIndex: 3, book: d }
  ]);
});

test("slot payload of an empty grid is empty", () => {
  assert.deepEqual(slotPayload([null, null, null, null]), []);
});

test("a tournament needs a name other than the placeholder", () => {
  assert.equal(hasTournamentName(""), false);
  assert.equal(hasTournamentName("   "), false);
  assert.equal(hasTournamentName(UNTITLED_TOURNAMENT), false);
  assert.equal(hasTournamentName(` ${UNTITLED_TOURNAMENT} `), false);
  assert.equal(hasTournamentName("Spring finals"), true);
});

test("creating a tournament from a draft saves the books already picked, at their own slots", async () => {
  const [a, , c] = ["A", "B", "C"].map(book);
  const calls: unknown[] = [];
  const created = await createSeededTournament(
    {
      createTournament: async (input) => { calls.push(["create", input]); return { id: "t1" } as never; },
      setTournamentSlots: async (id, slots) => { calls.push(["slots", id, slots]); }
    },
    { name: "Spring finals", bracketSize: 4, roundDurationMinutes: 60 },
    [a, null, c, null]
  );
  assert.equal(created.id, "t1");
  assert.deepEqual(calls, [
    ["create", { name: "Spring finals", bracketSize: 4, roundDurationMinutes: 60 }],
    ["slots", "t1", [{ slotIndex: 0, book: a }, { slotIndex: 2, book: c }]]
  ]);
});

test("creating an empty draft saves no slots", async () => {
  const calls: string[] = [];
  await createSeededTournament(
    {
      createTournament: async () => { calls.push("create"); return { id: "t1" } as never; },
      setTournamentSlots: async () => { calls.push("slots"); }
    },
    { name: "Spring finals", bracketSize: 4, roundDurationMinutes: 60 },
    [null, null, null, null]
  );
  assert.deepEqual(calls, ["create"]);
});
