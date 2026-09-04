// backend/src/modules/tierlists/service.test.ts
//
// Exercises service.ts against a hand-written in-memory
// TierlistsRepository fake — no real SQLite database needed, same seam
// backend/README.md describes for every other module's service layer.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TierlistsRepository } from "./domain/ports.js";
import type { TierlistRow } from "./domain/types.js";
import { createTierlistsPublicApi, createTierlistsService } from "./service.js";

function createInMemoryRepo(): TierlistsRepository {
  const tierlists = new Map<string, TierlistRow>();

  return {
    listByUser(userId) {
      return [...tierlists.values()].filter((t) => t.owner_user_id === userId);
    },
    getOwned(id, userId) {
      const t = tierlists.get(id);
      return t && t.owner_user_id === userId ? t : undefined;
    },
    insert(row) {
      tierlists.set(row.id, { ...row });
    },
    update(id, userId, patch) {
      const existing = tierlists.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged: TierlistRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
      tierlists.set(id, merged);
      return merged;
    },
    delete(id, userId) {
      const existing = tierlists.get(id);
      if (!existing || existing.owner_user_id !== userId) return false;
      tierlists.delete(id);
      return true;
    }
  };
}

function makeService() {
  return createTierlistsService(createInMemoryRepo());
}

test("createTierlist stores a tier list and getTierlist round-trips it", () => {
  const service = makeService();
  const created = service.createTierlist("u1", "Favorites");
  assert.equal(created.name, "Favorites");
  assert.deepEqual(created.data, {});
  const fetched = service.getTierlist("u1", created.id);
  assert.deepEqual(fetched, created);
});

test("listTierlists is scoped per user", () => {
  const service = makeService();
  const a = service.createTierlist("u1", "A");
  const b = service.createTierlist("u1", "B");
  service.createTierlist("u2", "Theirs");
  const listed = service.listTierlists("u1");
  assert.equal(listed.length, 2);
  assert.ok(listed.some((t) => t.id === a.id));
  assert.ok(listed.some((t) => t.id === b.id));
});

test("updateTierlist renames without touching data", () => {
  const service = makeService();
  const t = service.createTierlist("u1", "Old");
  const updated = service.updateTierlist("u1", t.id, { name: "New" });
  assert.equal(updated?.name, "New");
  assert.deepEqual(updated?.data, {});
});

test("updateTierlist replaces data without touching name", () => {
  const service = makeService();
  const t = service.createTierlist("u1", "Keep");
  const next = { tiers: [{ id: "s", label: "S", color: "#ff7f7f", bookKeys: ["b1"] }], pool: ["b2"] };
  const updated = service.updateTierlist("u1", t.id, { data: next });
  assert.equal(updated?.name, "Keep");
  assert.deepEqual(updated?.data, next);
  assert.deepEqual(service.getTierlist("u1", t.id)?.data, next);
});

test("updateTierlist returns undefined for an unowned tier list", () => {
  const service = makeService();
  const theirs = service.createTierlist("u2", "Theirs");
  assert.equal(service.updateTierlist("u1", theirs.id, { name: "Mine" }), undefined);
});

test("deleteTierlist returns false for an unowned tier list", () => {
  const service = makeService();
  const theirs = service.createTierlist("u2", "Theirs");
  assert.equal(service.deleteTierlist("u1", theirs.id), false);
});

test("a deleted tier list is no longer returned by getTierlist", () => {
  const service = makeService();
  const t = service.createTierlist("u1", "Doomed");
  assert.equal(service.deleteTierlist("u1", t.id), true);
  assert.equal(service.getTierlist("u1", t.id), undefined);
});

test("createTierlistsPublicApi resolves the raw document and defaults missing arrays", () => {
  const service = makeService();
  const api = createTierlistsPublicApi(service);

  const empty = service.createTierlist("u1", "Empty");
  assert.deepEqual(api.getTierlistData("u1", empty.id), { name: "Empty", tiers: [], pool: [] });

  const doc = { tiers: [{ id: "s", label: "S", color: "#ff7f7f", bookKeys: ["b1"] }], pool: ["b2"] };
  const ranked = service.createTierlist("u1", "Ranked");
  service.updateTierlist("u1", ranked.id, { data: doc });
  assert.deepEqual(api.getTierlistData("u1", ranked.id), { name: "Ranked", tiers: doc.tiers, pool: doc.pool });

  assert.equal(api.getTierlistData("u2", ranked.id), undefined);
  assert.equal(api.getTierlistData("u1", "00000000-0000-4000-8000-000000000000"), undefined);
});
