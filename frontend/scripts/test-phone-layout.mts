import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Duel, TournamentView } from "@scripta/shared";
import { BracketTree } from "../src/components/arena/BracketTree";
import { DuelCard } from "../src/components/arena/DuelCard";
import { MobileBlockPreview } from "../src/components/murals/MobileBlockPreview";
import { blockSize } from "../src/lib/murals";

const side = (title: string) => ({ workId: title, title, author: "Someone", cover: null, votes: 0 });
const duel = (duelIndex: number): Duel => ({
  id: `d${duelIndex}`,
  roundNumber: 1,
  duelIndex,
  bookA: side("A Very Long Title That Would Not Fit Beside Its Rival"),
  bookB: side("Short"),
  winnerWorkId: null,
  status: "active",
  opensAt: "2026-10-25T00:00:00Z",
  closesAt: "2026-10-26T00:00:00Z",
  hasVoted: false
});
const tournament: TournamentView = {
  id: "t",
  name: "T",
  bracketSize: 16,
  roundDurationMinutes: 1440,
  status: "active",
  currentRound: 1,
  createdAt: "",
  ownerUserId: "u",
  covers: [],
  filledSlots: 16,
  winner: null,
  slots: [],
  duels: [0, 1, 2, 3, 4, 5, 6, 7].map(duel)
};

test("duel side cards can shrink below their title, so both stay inside the match card", () => {
  const html = renderToString(createElement(MemoryRouter, null, createElement(DuelCard, { duel: duel(0), round: "Round 1", onVote: () => undefined, votingDisabledReason: null })));
  assert.equal(html.match(/<div class="relative flex min-w-0 flex-1 flex-col">/g)?.length, 2);
});

test("a desktop round column fills the row and wraps its duels, so a lone round is not a narrow strip", () => {
  const html = renderToString(createElement(BracketTree, { tournament, renderDuel: (id: string) => id }));
  assert.match(html, /class="grid min-w-72 flex-1 grid-cols-\[repeat\(auto-fit,minmax\(18rem,1fr\)\)\] content-around gap-6"><h3 class="col-span-full/);
});

test("a short phone profile block shrinks its avatar to the block's height", () => {
  const profile = { username: "alice", avatarUrl: null };
  const block = { id: "p", type: "profile" as const, bio: "", favoriteGenres: [], layout: { x: 0, y: 0, w: 12, h: 3 } };
  const short = renderToString(createElement(MobileBlockPreview, { block, books: [], images: [], profile, width: 328, height: 28 }));
  assert.match(short, /justify-center block-px-2/);
  assert.match(short, /width:20px;height:20px/);
  const tall = renderToString(createElement(MobileBlockPreview, { block, books: [], images: [], profile, width: 328, height: 120 }));
  assert.match(tall, /width:40px;height:40px/);
});

test("a new text block is tall enough for a heading and a line of text", () => {
  assert.equal(blockSize("text").h, 3);
});

test("the series custom-style chip never wraps between its words", () => {
  const source = readFileSync(new URL("../src/pages/GroupsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /className="[^"]*\binline-block\b[^"]*\bwhitespace-nowrap\b[^"]*">\s*custom style/);
});
