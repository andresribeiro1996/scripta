import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { digestTarget, type DashboardFeedPage, type DigestItem } from "@scripta/shared";
import { feedEventLabel } from "@scripta/shared/community";
import { FeedCard } from "../src/components/home/FeedCard";
import { ForYouPanel } from "../src/components/home/ForYouPanel";

const actor = { userId: "u1", username: "alice", avatarUrl: null };
const createdAt = "2026-10-14T10:00:00.000Z";
const tournament = { kind: "tournament" as const, id: "g1", name: "Cup of classics", bracketSize: 8, status: "active" as const, bookCount: 8, covers: ["a.png", "b.png"] };
const quiz = { kind: "quiz" as const, id: "q1", voteCode: "qc", name: "Dune trivia", questionCount: 5, playCount: 2, playOpen: true, covers: ["q.png", "r.png"] };

const finishedReading: DigestItem = { kind: "reading", id: "r1", actor, book: { title: "Piranesi", author: "Susanna Clarke", coverUrl: "p.png", workId: "w1" }, finished: true, createdAt };
const publishedTournament: DigestItem = { kind: "publication", id: "e1", actor, type: "tournament_published", content: tournament, createdAt };
const publishedQuiz: DigestItem = { kind: "publication", id: "e2", actor, type: "quiz_published", content: quiz, createdAt };
const publishedMural: DigestItem = { kind: "mural", id: "m1", actor, mural: { id: "m", name: "My wall", theme: "light", coverImageUrl: null }, createdAt };
const followedMe: DigestItem = { kind: "follow", id: "f1", actor, viewerFollows: false, createdAt };
const followedMeAlreadyFollowing: DigestItem = { kind: "follow", id: "f2", actor: { userId: "u2", username: "bob", avatarUrl: null }, viewerFollows: true, createdAt };
const playedMyQuiz: DigestItem = { kind: "participation", id: "quiz:q", game: { kind: "quiz", id: "q", name: "Guess the classic", covers: [] }, actors: [actor], count: 1, createdAt };

const card = (item: DigestItem) => renderToString(createElement(MemoryRouter, null, createElement(FeedCard, { item })));

function forYou(items: DigestItem[], page: Partial<DashboardFeedPage>) {
  const client = new QueryClient();
  const first: DashboardFeedPage = { items, nextCursor: null, seenAt: "2026-10-01T00:00:00.000Z", personalNewCount: 0, followingNewCount: 0, ...page };
  client.setQueryData(["community", "dashboard", "activity"], { pages: [first], pageParams: [undefined] });
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(ForYouPanel))));
}

test("a finished book: avatar, name, event label, time, cover, title, author, and its primary link", () => {
  const html = card(finishedReading);
  assert.match(html, /<article/);
  assert.match(html, new RegExp(feedEventLabel(finishedReading)));
  assert.match(html, />Piranesi</);
  assert.match(html, /Susanna Clarke/);
  assert.match(html, new RegExp(`href="${digestTarget(finishedReading)}"`));
});

test("a tournament shows VS covers, a quiz the ? disc, a mural its tile", () => {
  assert.match(card(publishedTournament), />VS</);
  assert.match(card(publishedQuiz), />\?</);
  assert.match(card(publishedMural), /Open mural/);
});

test("the tournament and quiz tiles are block-level so their size and background apply", () => {
  for (const html of [card(publishedTournament), card(publishedQuiz)]) assert.match(html, /<span class="relative block h-27 w-30 shrink-0 rounded-xl bg-\(--color-(accent|reference)-soft\)/);
});

test("For you: Follow back, View results and Following, with the new count", () => {
  const html = forYou([followedMe, playedMyQuiz, followedMeAlreadyFollowing], { personalNewCount: 2 });
  assert.match(html, /<button[^>]*>Follow back<\/button>/);
  assert.match(html, /aria-label="Follow back alice"/);
  assert.match(html, /View results/);
  assert.match(html, />Following</);
  assert.match(html, /2 new/);
});

test("For you marks the feed seen through the shared gate, then clears the counts", () => {
  const src = readFileSync(new URL("../src/components/home/ForYouPanel.tsx", import.meta.url), "utf8");
  assert.match(src, /IntersectionObserver/);
  assert.match(src, /shouldMarkFeedSeen\(/);
  assert.match(src, /markDashboardSeen\(/);
  assert.match(src, /clearDashboardCounts/);
  assert.doesNotMatch(src, /\.slice\(0, 6\)/);
});

test("the circle feed: Retry on a failed load, and onboarding only when there is nothing more to load", () => {
  const home = readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8");
  assert.match(home, /isError[\s\S]*?Retry/);
  assert.match(home, /!hasNextPage|hasNextPage === false/);
  assert.doesNotMatch(home, /BUTTON_PRIMARY[^\n]*Find people|Find people[^\n]*BUTTON_PRIMARY/);
});

test("feed covers come from the item's cover URL only, never a title lookup", () => {
  const src = readFileSync(new URL("../src/components/home/FeedCard.tsx", import.meta.url), "utf8");
  assert.match(src, /url \? \{ _coverUrl: url \} : \{\}/);
  assert.doesNotMatch(src, /Title: title|Attribution: author/);
  assert.match(src, /<BookCover book=\{book\} title=\{title\}/);
});

test("For you follow back refreshes the circle, and a failed refresh or page with rows shown offers Retry", () => {
  const src = readFileSync(new URL("../src/components/home/ForYouPanel.tsx", import.meta.url), "utf8");
  assert.match(src, /queryKey: \["community", "dashboard", "circle"\]/);
  assert.match(src, /feed\.isError && items\.length > 0/);
  assert.match(src, /Couldn't refresh activity\./);
});
