import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "arena-game-source-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { applyArenaMigrations } = await import("./sqlite/connection.js");
const { createSqliteArenaRepository } = await import("./sqlite/sqliteArenaRepository.js");
const { createArenaPublicApi, createArenaService } = await import("../service.js");
const { createCompletedTournaments, createTournamentGameSource } = await import("./communityGameSource.js");

const works = {
  knownWorkIds: (ids: string[]) => ids,
  canonicalWorkIds: (ids: string[]) => new Map(ids.map((id) => [id, id])),
  castOf: () => undefined
};

const book = (n: number) => ({ workId: `w${n}`, title: `Book ${n}`, author: `Author ${n}`, cover: `https://covers.test/${n}.jpg` });

function setup() {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const service = createArenaService(createSqliteArenaRepository(db), works);
  const api = createArenaPublicApi(service);
  const seeded = (owner: string, name: string, bracketSize = 2, filled = bracketSize) => {
    const tournament = service.createTournament(owner, { name, bracketSize, roundDurationMinutes: 60 });
    service.setSlotsManual(tournament.id, owner, Array.from({ length: filled }, (_, i) => ({ slotIndex: i, book: book(i + 1) })));
    return tournament;
  };
  const started = (owner: string, name: string, bracketSize = 2) => {
    const tournament = seeded(owner, name, bracketSize);
    service.start(tournament.id, owner);
    return tournament;
  };
  return { service, source: createTournamentGameSource(api), completed: createCompletedTournaments(api), seeded, started };
}

test("content kind and id match the listing, and covers come through as the public API returns them", () => {
  const { source, started } = setup();
  const tournament = started("u1", "Best of", 16);

  const card = source.get(tournament.id)!;

  assert.equal(card.content.kind, "tournament");
  assert.equal(card.content.id, card.id);
  assert.equal(card.content.bracketSize, 16);
  assert.equal(card.content.bookCount, 16);
  assert.equal(card.promoted, false);
  assert.deepEqual(card.content.covers, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `https://covers.test/${n}.jpg`));
});

test("getMany marks viewerVoted only when a viewer is given", () => {
  const { service, source, started } = setup();
  const voted = started("u1", "Voted");
  const unvoted = started("u1", "Unvoted");
  const duel = service.getTournamentView(voted.id)!.duels[0]!;
  service.vote(voted.id, duel.id, "token-1", "w1", "u9");

  assert.ok(source.getMany([voted.id, unvoted.id]).every((card) => !("viewerVoted" in card.content)));
  const withViewer = source.getMany([voted.id, unvoted.id], "u9");
  assert.deepEqual(withViewer.map((card) => [card.id, card.content.viewerVoted]).sort(), [[voted.id, true], [unvoted.id, false]].sort());
});

test("an unpublished or unknown id is left out of getMany and undefined from get", () => {
  const { source, seeded, started } = setup();
  const live = started("u1", "Live");
  const seeding = seeded("u1", "Seeding", 4, 1);

  assert.equal(source.get(seeding.id), undefined);
  assert.equal(source.get("ghost"), undefined);
  assert.deepEqual(source.getMany([live.id, seeding.id, "ghost"]).map((card) => card.id), [live.id]);
});

test("a seeding tournament is not listed by owner", () => {
  const { source, seeded, started } = setup();
  const live = started("u1", "Live");
  seeded("u1", "Seeding", 4, 1);

  assert.deepEqual(source.listByOwner("u1").map((card) => card.id), [live.id]);
});

test("listByOwner is newest first", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T00:00:00Z") });
  const { source, started } = setup();
  const first = started("u1", "First");
  t.mock.timers.tick(1000);
  const second = started("u1", "Second");

  assert.deepEqual(source.listByOwner("u1").map((card) => card.id), [second.id, first.id]);
});

test("shelfFacts carries empty placements, and a champion once the final settles", () => {
  const { service, source, started } = setup();
  const tournament = started("u1", "Final");
  const [before] = source.shelfFacts(null, null);
  assert.equal(before!.kind, "tournament");
  assert.deepEqual(before!.placements, []);
  assert.equal(before!.champion, null);

  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  service.vote(tournament.id, duel.id, "token-1", "w1");
  service.settleEarly(tournament.id, "u1", duel.id);

  const [after] = source.shelfFacts(null, null);
  assert.equal(after!.champion?.workId, "w1");
  assert.deepEqual(after!.placements, []);
});

test("completed tournaments carry their card and winner", () => {
  const { service, completed, started } = setup();
  const tournament = started("u1", "Final");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  service.vote(tournament.id, duel.id, "token-1", "w1", "u9");
  service.settleEarly(tournament.id, "u1", duel.id);

  const rows = completed("u9", "2000-01-01T00:00:00.000Z");

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.card.id, tournament.id);
  assert.equal(rows[0]!.card.content.status, "completed");
  assert.deepEqual(rows[0]!.winner, { title: "Book 1", author: "Author 1", cover: "https://covers.test/1.jpg", workId: "w1" });
  assert.ok(rows[0]!.completedAt);
  assert.deepEqual(completed("u8", "2000-01-01T00:00:00.000Z"), []);
});

test("a character tournament card carries its subject label and the scope cover", () => {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const cast = {
    scope: { kind: "work" as const, key: "dune", label: "Dune", coverUrl: "https://covers.test/dune.jpg", workCount: 1 },
    characters: [0, 1, 2, 3].map((n) => ({ id: `ch:dune|c${n}`, name: `C${n}`, works: 1 }))
  };
  const service = createArenaService(createSqliteArenaRepository(db), { ...works, castOf: () => cast });
  const source = createTournamentGameSource(createArenaPublicApi(service));
  const created = service.createTournament("u1", { name: "Dune", bracketSize: 4, roundDurationMinutes: 60, characters: { workId: "dune", characterIds: cast.characters.map((c) => c.id) } });

  const card = source.get(created.id)!;
  assert.deepEqual(card.content.subject, { kind: "characters", label: "Dune" });
  assert.deepEqual(card.content.covers, ["https://covers.test/dune.jpg"]);
  assert.equal(source.listByOwner("u1").length, 1);
  assert.deepEqual(source.shelfFacts(null, null), []);
});
