/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { bracketShape, type Duel } from "@scripta/shared";
import { setLocalePreference, t } from "../../i18n";
import type { Tournament } from "./api.js";
import { emptyCopy, GAMES_TABS, gameRow, ownedItems, tournamentProgress } from "./arenaHome.js";
import { arenaViewTabs, matchEmptyCopy, matchNote, roundHeadline } from "./arenaView.js";

const tournament: Tournament = {
  id: "t1",
  name: "Best of 2025",
  bracketSize: 8,
  roundDurationMinutes: 60,
  status: "seeding",
  currentRound: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ownerUserId: "u1",
  covers: [],
  filledSlots: 3,
  winner: null,
  subject: null,
};

const duel = (over: Partial<Duel> = {}): Duel => ({
  id: "d1",
  roundNumber: 1,
  duelIndex: 0,
  bookA: { workId: "a", title: "A", author: "Author A", cover: null, votes: 0 },
  bookB: { workId: "b", title: "B", author: "Author B", cover: null, votes: 0 },
  winnerWorkId: null,
  status: "active",
  opensAt: "2026-01-01T00:00:00.000Z",
  closesAt: "2026-01-01T01:00:00.000Z",
  hasVoted: false,
  ...over,
});

test("the tournament screens stay English by default", () => {
  assert.equal(t("arena.tabBracket"), "Bracket");
  assert.equal(emptyCopy("tournaments", false, "en").title, "No tournaments yet");
  assert.equal(tournamentProgress(tournament, "en").label, "3 of 8 slots filled");
  assert.deepEqual(arenaViewTabs("active", "en").map((option) => option.label), ["Bracket", "Vote"]);
});

test("the tournament screens follow the Portuguese pick", () => {
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("arena.tabBracket"), "Chave");
    assert.equal(t("arena.winsTiebreak", { title: "Dune" }), "Dune vence o desempate");
    assert.equal(t(GAMES_TABS[0].labelKey), "Explorar");
  } finally {
    setLocalePreference("auto");
  }
});

test("the tournament models take the locale they are given", () => {
  assert.equal(emptyCopy("tournaments", false, "pt-PT").title, "Ainda não há torneios");
  assert.equal(emptyCopy("tierlists", true, "pt-PT").body, "Experimente outra pesquisa.");
  assert.equal(tournamentProgress(tournament, "pt-PT").label, "3 de 8 posições preenchidas");
  assert.equal(tournamentProgress({ ...tournament, status: "active", currentRound: 2 }, "pt-PT").label, "Ronda 2 de 3");
  const row = gameRow({ kind: "owned", key: "t1", item: ownedItems("tournaments", [tournament], [], "pt-PT")[0]! }, "pt-PT");
  assert.equal(row.meta, "Chave de 8 livros");
  assert.deepEqual(row.badges, [{ label: "Em preparação", tone: "neutral" }]);
  assert.deepEqual(arenaViewTabs("active", "pt-PT").map((option) => option.label), ["Chave", "Votar"]);
  assert.equal(matchEmptyCopy("active", true, "pt-PT").title, "Está tudo em dia");
  assert.equal(matchNote(duel({ status: "tied_pending_tiebreak" }), "pt-PT"), "Desempate necessário");
  assert.equal(matchNote(duel({ status: "settled", winnerWorkId: "a" }), "pt-PT"), "Decidido · sem votos");
});

test("the round headline names the round and the closing date in Portuguese", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const settled = (i: number) => duel({ id: `s${i}`, roundNumber: 1, duelIndex: i, status: "settled", winnerWorkId: "a" });
  const open = duel({ id: "open", roundNumber: 1, duelIndex: 2, closesAt: "2026-09-26T18:00:00.000Z" });
  const quarters = roundHeadline(bracketShape(8, [settled(0), settled(1), open]), 0, "pt-PT", now);
  assert.equal(quarters.title, "Quartos de final · Ronda 1 de 3");
  assert.equal(quarters.status, "2 de 4 decididos · Fecha sáb 26 set");

  const numbered = roundHeadline(bracketShape(16, []), 0, "pt-PT", now);
  assert.equal(numbered.title, "Ronda 1 de 4");
});
