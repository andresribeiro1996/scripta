import assert from "node:assert/strict";
import test from "node:test";
import { gamesSections, gameStage, tournamentBadge, votedTierlistBadges } from "./gamesList.js";

test("tournamentBadge names the round of an active bracket", () => {
  assert.deepEqual(tournamentBadge({ status: "seeding" }, "en"), { label: "Seeding", tone: "neutral" });
  assert.deepEqual(tournamentBadge({ status: "active", currentRound: 2 }, "en"), { label: "Round 2", tone: "accent" });
  assert.deepEqual(tournamentBadge({ status: "active", currentRound: 0 }, "en"), { label: "In progress", tone: "info" });
  assert.deepEqual(tournamentBadge({ status: "active", currentRound: null }, "en"), { label: "In progress", tone: "info" });
  assert.deepEqual(tournamentBadge({ status: "active" }, "en"), { label: "In progress", tone: "info" });
  assert.deepEqual(tournamentBadge({ status: "completed" }, "en"), { label: "Completed", tone: "success" });
  assert.deepEqual(tournamentBadge({ status: "active", currentRound: 3 }, "pt-PT"), { label: "Ronda 3", tone: "accent" });
});

test("gameStage is draft without a vote code, then open or closed", () => {
  assert.equal(gameStage(null, true), "draft");
  assert.equal(gameStage("abc", true), "open");
  assert.equal(gameStage("abc", false), "closed");
});

test("votedTierlistBadges pair the voting state with Voted", () => {
  assert.deepEqual(votedTierlistBadges({ votingOpen: true }, "en"), [{ label: "Voting open", tone: "accent" }, { label: "Voted", tone: "info" }]);
  assert.deepEqual(votedTierlistBadges({ votingOpen: false }, "en"), [{ label: "Closed", tone: "neutral" }, { label: "Voted", tone: "info" }]);
});

test("gamesSections filters both lists by a trimmed, case-insensitive search and the owner filter", () => {
  const owned = [{ name: "Alpha Cup" }, { name: "Beta" }, { name: "alpha two" }];
  const voted = [{ name: "ALPHA voted" }, { name: "Gamma" }];
  assert.deepEqual(gamesSections({ owned, voted, search: "  alpha ", owner: "all" }), {
    created: [{ name: "Alpha Cup" }, { name: "alpha two" }],
    voted: [{ name: "ALPHA voted" }],
  });
  assert.deepEqual(gamesSections({ owned, voted, search: "", owner: "all" }), { created: owned, voted });
  assert.deepEqual(gamesSections({ owned, voted: null, search: "", owner: "all" }), { created: owned, voted: [] });
  assert.deepEqual(gamesSections({ owned, voted, search: "", owner: "mine" }), { created: owned, voted: [] });
  assert.deepEqual(gamesSections({ owned, voted, search: "", owner: "voted" }), { created: [], voted });
});
