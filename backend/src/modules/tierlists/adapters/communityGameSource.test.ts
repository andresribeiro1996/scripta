import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PublicBookData } from "@scripta/shared";

const scratchDir = mkdtempSync(join(tmpdir(), "tierlists-game-source-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { applyTierlistsMigrations } = await import("./sqlite/connection.js");
const { createSqliteTierlistsRepository } = await import("./sqlite/sqliteTierlistsRepository.js");
const { createTierlistsPublicApi, createTierlistsService } = await import("../service.js");
const { createTierlistGameSource } = await import("./communityGameSource.js");

const works = {
  knownWorkIds: (ids: string[]) => ids,
  canonicalByKey: (ids: Map<string, string>) => new Map(ids),
  publicBooksByWork: (_ownerUserId: string, workIds: string[]) =>
    new Map(workIds.map((id) => [id, { key: id, workId: id, title: id, author: "A", isbn: null, imageId: null, coverUrl: `https://covers.test/${id}.jpg`, readStatus: null } satisfies PublicBookData]))
};

const tiers = [{ id: "s", label: "S", color: "#c9482f", workIds: [] as string[] }];

function setup() {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const repo = createSqliteTierlistsRepository(db);
  const service = createTierlistsService(repo, works);
  const source = createTierlistGameSource(createTierlistsPublicApi(service, works));
  const publish = (owner: string, name: string, pool: string[] = ["b1", "b2"]) => {
    const outcome = service.createTierlist(owner, { name, data: { tiers, pool }, access: "anonymous" });
    assert.ok(outcome.ok);
    return outcome.ok ? outcome.tierlist : (undefined as never);
  };
  return { repo, service, source, publish };
}

test("content kind and id match the listing, and covers come through as the public API returns them", () => {
  const { source, publish } = setup();
  const pool = Array.from({ length: 10 }, (_, i) => `b${i}`);
  const list = publish("u1", "Fantasy", pool);

  const card = source.get(list.id)!;

  assert.equal(card.content.kind, "tierlist");
  assert.equal(card.content.id, card.id);
  assert.equal(card.content.name, "Fantasy");
  assert.equal(card.content.voteCode, list.voteCode);
  assert.equal(card.ownerUserId, "u1");
  assert.deepEqual(card.content.covers, pool.slice(0, 8).map((id) => `https://covers.test/${id}.jpg`));
  assert.equal("viewerVoted" in card.content, false);
});

test("getMany marks viewerVoted only when a viewer is given", () => {
  const { service, source, publish } = setup();
  const voted = publish("u1", "Voted");
  const unvoted = publish("u1", "Unvoted");
  assert.ok(service.submitBallot(voted.voteCode!, [{ workId: "b1", tierId: "s" }], { kind: "user", userId: "u9" }).ok);

  assert.ok(source.getMany([voted.id, unvoted.id]).every((card) => !("viewerVoted" in card.content)));
  const withViewer = source.getMany([voted.id, unvoted.id], "u9");
  assert.deepEqual(withViewer.map((card) => [card.id, card.content.viewerVoted]).sort(), [[voted.id, true], [unvoted.id, false]].sort());
});

test("an unpublished or unknown id is left out of getMany and undefined from get", () => {
  const { service, source, publish } = setup();
  const live = publish("u1", "Live");
  const draft = service.createTierlist("u1", { name: "Draft" });
  assert.ok(draft.ok);
  const draftId = draft.ok ? draft.tierlist.id : "";

  assert.equal(source.get(draftId), undefined);
  assert.equal(source.get("ghost"), undefined);
  assert.deepEqual(source.getMany([live.id, draftId, "ghost"]).map((card) => card.id), [live.id]);
  assert.deepEqual(source.listByOwner("u1").map((card) => card.id), [live.id]);
});

test("listByOwner is newest first", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T00:00:00Z") });
  const { source, publish } = setup();
  const first = publish("u1", "First");
  t.mock.timers.tick(1000);
  const second = publish("u1", "Second");

  assert.deepEqual(source.listByOwner("u1").map((card) => card.id), [second.id, first.id]);
});

test("promoted is true only for a promoted list", () => {
  const { repo, source, publish } = setup();
  const plain = publish("u1", "Plain");
  const promoted = publish("u1", "Promoted");
  repo.promote(promoted.id, "2026-01-02T00:00:00.000Z");

  assert.equal(source.get(plain.id)!.promoted, false);
  assert.equal(source.get(promoted.id)!.promoted, true);
  const listed = source.discoverWindow("", 10);
  assert.deepEqual(listed.map((row) => [row.id, row.promoted]).sort(), [[plain.id, false], [promoted.id, true]].sort());
  assert.deepEqual(source.discoverByWorks(["b1"], 10).map((row) => [row.id, row.promoted]).sort(), [[plain.id, false], [promoted.id, true]].sort());
});

test("shelfFacts carries the placements and a null champion", () => {
  const { service, source, publish } = setup();
  const list = publish("u1", "Fantasy");
  assert.ok(service.submitBallot(list.voteCode!, [{ workId: "b1", tierId: "s" }], { kind: "user", userId: "u9" }).ok);

  const facts = source.shelfFacts(null, null);

  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.kind, "tierlist");
  assert.equal(facts[0]!.id, list.id);
  assert.equal(facts[0]!.champion, null);
  assert.deepEqual(facts[0]!.placements.map((p) => [p.workId, p.tierIndex, p.tierCount]), [["b1", 0, 1]]);
});

test("participation rows carry the vote code", () => {
  const { service, source, publish } = setup();
  const list = publish("u1", "Fantasy");
  assert.ok(service.submitBallot(list.voteCode!, [{ workId: "b1", tierId: "s" }], { kind: "user", userId: "u9" }).ok);

  const rows = source.participation("u1", "2000-01-01T00:00:00.000Z");

  assert.deepEqual(rows.map((row) => [row.id, row.voteCode, row.participantCount]), [[list.id, list.voteCode, 1]]);
});
