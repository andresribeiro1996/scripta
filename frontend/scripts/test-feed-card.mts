import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shareLink } from "../src/lib/shareLink";
import { digestTarget, type DashboardFeedPage, type DigestItem } from "@scripta/shared";
import { feedEventLabel, type ActivityComment, type ActivityEngagement } from "@scripta/shared/community";
import { FeedCard } from "../src/components/home/FeedCard";
import { ForYouPanel } from "../src/components/home/ForYouPanel";
import type { FeedActions } from "../src/hooks/useFeedActions";
import { CommentsSheet } from "../src/components/home/CommentsSheet";
import { ConfirmProvider } from "../src/components/ConfirmDialog";
import { ToastProvider } from "../src/components/Toaster";

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

const piranesiOnShelf = { Title: "Piranesi", Attribution: "Susanna Clarke", ISBN: "" };

function card(item: DigestItem, opts: { engagement?: Record<string, ActivityEngagement>; saved?: string[]; library?: Array<Record<string, unknown>>; wanting?: string } = {}) {
  const noop = () => {};
  const actions: FeedActions = { engagement: opts.engagement ?? {}, saved: new Set(opts.saved ?? []), savedReady: true, busy: { like: false, save: false }, wanting: opts.wanting ?? null, loadError: null, retryLoad: noop, like: noop, save: noop, wantToRead: noop, share: noop };
  return renderToString(createElement(MemoryRouter, null, createElement(FeedCard, { item, actions, books: opts.library ?? [], works: undefined })));
}

const me = { userId: "u9", username: "me", avatarUrl: null };

function comments(id: string, list: ActivityComment[]) {
  const client = new QueryClient();
  client.setQueryData(["community", "comments", id], { pages: [{ items: list, nextCursor: null }], pageParams: [undefined] });
  return renderToString(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(CommentsSheet, { id, title: "Piranesi", onClose: () => {} })))));
}

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
  assert.match(src, /await invalidateAfterFollow\(queryClient\)/);
  assert.match(src, /feed\.isError && items\.length > 0/);
  assert.match(src, /Couldn't refresh activity\./);
});

test("the footer: like with its count and pressed state, comments with count, share", () => {
  const html = card(finishedReading, { engagement: { [finishedReading.id]: { likes: 2, liked: true, comments: 1 } } });
  assert.match(html, /<button(?=(?:=>|[^>])*aria-pressed="true")(?=(?:=>|[^>])*aria-label="Like, 2 likes")(?:=>|[^>])*>/);
  assert.match(html, /<button(?=(?:=>|[^>])*aria-label="Comments, 1")(?:=>|[^>])*>/);
  assert.match(html, /<button(?:=>|[^>])*>[\s\S]*?Share<\/button>/);
});

test("Save only where the backend can save: on a game card, never on a book card", () => {
  assert.match(card(publishedTournament), /<button(?=(?:=>|[^>])*aria-label="Save")(?=(?:=>|[^>])*aria-pressed="false")(?:=>|[^>])*>/);
  assert.match(card(publishedTournament, { saved: ["tournament:g1"] }), /<button(?=(?:=>|[^>])*aria-label="Save")(?=(?:=>|[^>])*aria-pressed="true")(?:=>|[^>])*>/);
  assert.doesNotMatch(card(finishedReading), /aria-label="Save"/);
});

test("a book card offers Want to read, or Open in your shelf when you hold the book", () => {
  assert.match(card(finishedReading), /<button(?:=>|[^>])*>Want to read<\/button>/);
  assert.match(card(finishedReading, { library: [piranesiOnShelf] }), /Open in your shelf/);
  assert.doesNotMatch(card(finishedReading, { library: [piranesiOnShelf] }), /Want to read/);
});

test("a saved card has no like or comment buttons", () => {
  const html = card({ ...publishedTournament, id: `saved:${publishedTournament.id}` });
  assert.doesNotMatch(html, /aria-label="Like/);
  assert.doesNotMatch(html, /aria-label="Comments/);
});

test("actions keep the app's limits and paths", () => {
  const hook = readFileSync(new URL("../src/hooks/useFeedActions.ts", import.meta.url), "utf8");
  assert.match(hook, /staleTime: 30_000/);
  assert.match(hook, /50/);
  assert.match(hook, /hasActivityThread\(/);
  assert.match(hook, /toRecommendation\(/);
  assert.match(hook, /preserveExisting: true/);
  assert.match(hook, /shareLink\(/);
  assert.doesNotMatch(readFileSync(new URL("../src/pages/WorkPage.tsx", import.meta.url), "utf8"), /navigator\.share/);
  assert.match(hook, /\["community", ?"saved", ?"list"\]/);
  assert.match(readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"), /path="\/dashboard\/saved"/);
});

test("Home links to Saved from its header", () => {
  const home = readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8");
  assert.match(home, /aria-label="Saved"/);
  assert.match(home, /to="\/dashboard\/saved"/);
});

test("comments: both shown, delete only on your own, a labelled composer with one Post button", () => {
  const html = comments("a1", [{ id: "c1", author: actor, text: "Loved it", createdAt: "2026-10-29T10:00:00Z", own: false }, { id: "c2", author: me, text: "Same", createdAt: "2026-10-29T11:00:00Z", own: true }]);
  assert.match(html, /Loved it[\s\S]*Same/);
  assert.equal(html.match(/>Delete</g)?.length, 1);
  assert.match(html, /<label[^>]*for="[^"]+"[^>]*>[^<]*Comment/);
  assert.match(html, /<textarea[^>]*id="/);
  assert.equal(html.match(/>Post</g)?.length, 1);
  assert.equal(html.match(/>Cancel</g)?.length, 1);
  assert.match(html, /aria-label="Delete your comment &quot;Same&quot;"/);
  assert.ok(html.indexOf("<textarea") > html.indexOf("Same"));
});

test("comments: the Post button starts disabled, and the feed comment button opens the sheet", () => {
  const html = comments("a1", []);
  assert.match(html, /<button(?=(?:=>|[^>])*disabled)(?:=>|[^>])*>Post<\/button>/);
  const card = readFileSync(new URL("../src/components/home/FeedCard.tsx", import.meta.url), "utf8");
  assert.match(card, /<CommentsSheet /);
  assert.match(card, /setCommentsOpen\(true\)/);
});

test("comments: the keys, the 429 message and the confirm before delete", () => {
  const src = readFileSync(new URL("../src/components/home/CommentsSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /const key = \["community", "comments", id\]/);
  assert.match(src, /staleTime: 30_000/);
  assert.match(src, /ENGAGEMENT_KEY/);
  assert.match(src, /status === 429/);
  assert.match(src, /await confirm\(/);
  assert.match(src, /maxLength=\{1500\}/);
  assert.match(src, /remove\.reset\(\)/);
  assert.match(src, /send\.reset\(\)/);
  assert.match(src, /fieldRef\.current\?\.focus\(\)/);
});

test("comments: a pending post is never reset by a delete, nor a pending delete by a post", () => {
  const src = readFileSync(new URL("../src/components/home/CommentsSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(!send\.isPending\) send\.reset\(\)/);
  assert.match(src, /if \(!remove\.isPending\) remove\.reset\(\)/);
  assert.doesNotMatch(src.replace(/if \(!(send|remove)\.isPending\) (send|remove)\.reset\(\)/g, ""), /(send|remove)\.reset\(\)/);
});

test("comments: the sheet cannot be dismissed while a post is in flight", () => {
  const src = readFileSync(new URL("../src/components/home/CommentsSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /const close = \(\) => \{\s*if \(!send\.isPending\) onClose\(\);/);
  assert.match(src, /<Sheet\s+title="Comments"\s+onClose=\{close\}/);
  assert.match(src, /<button(?=(?:=>|[^>])*disabled=\{send\.isPending\})(?=(?:=>|[^>])*onClick=\{close\})(?:=>|[^>])*>Cancel<\/button>/);
  assert.doesNotMatch(src, /onClick=\{onClose\}/);
});

test("comments: a failed refresh with comments shown says so and offers Retry", () => {
  const src = readFileSync(new URL("../src/components/home/CommentsSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /query\.isError && items\.length > 0 && !isFetchNextPageError/);
  assert.match(src, /Couldn't refresh comments\./);
});

test("feed actions surface a failed engagement or saved-state load, once, on Home", () => {
  const hook = readFileSync(new URL("../src/hooks/useFeedActions.ts", import.meta.url), "utf8");
  assert.match(hook, /Couldn't load reactions\./);
  assert.match(hook, /Couldn't load saved items\./);
  assert.match(hook, /retryLoad/);
  const home = readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8");
  assert.match(home, /actions\.loadError/);
  assert.match(home, /actions\.retryLoad/);
  assert.doesNotMatch(readFileSync(new URL("../src/components/home/FeedCard.tsx", import.meta.url), "utf8"), /loadError/);
});

test("Saved skips the saved-state fetch and its Retry refetches unless the next page failed", () => {
  const src = readFileSync(new URL("../src/pages/SavedPage.tsx", import.meta.url), "utf8");
  assert.match(src, /useFeedActions\(items, \{ trackSaved: false \}\)/);
  assert.match(src, /query\.isFetchNextPageError \? fetchNextPage\(\) : query\.refetch\(\)/);
  assert.match(readFileSync(new URL("../src/hooks/useFeedActions.ts", import.meta.url), "utf8"), /trackSaved/);
});

test("Want to read shows Adding… on the card being added and disables the others", () => {
  assert.match(card(finishedReading, { wanting: finishedReading.id }), /<button(?=(?:=>|[^>])*disabled="")(?:=>|[^>])*>Adding…<\/button>/);
  const other = card(finishedReading, { wanting: "someone-else" });
  assert.match(other, /<button(?=(?:=>|[^>])*disabled="")(?:=>|[^>])*>Want to read<\/button>/);
  assert.doesNotMatch(card(finishedReading), /Adding…|<button(?=(?:=>|[^>])*disabled="")(?:=>|[^>])*>Want to read<\/button>/);
});

function stubNavigator(value: object, run: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  return run().finally(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
}

test("shareLink: native share, silent on AbortError, else clipboard with a toast", async () => {
  const toasts: Array<{ kind?: string; message: string }> = [];
  const toast = (options: { kind?: string; message: string }) => void toasts.push(options);
  const shared: unknown[] = [];
  await stubNavigator({ share: async (data: unknown) => void shared.push(data) }, () => shareLink("T", "https://x/y", toast));
  assert.deepEqual(shared, [{ title: "T", url: "https://x/y" }]);
  await stubNavigator({ share: async () => { throw new DOMException("cancelled", "AbortError"); } }, () => shareLink("T", "u", toast));
  assert.deepEqual(toasts, []);
  const copied: string[] = [];
  await stubNavigator({ clipboard: { writeText: async (text: string) => void copied.push(text) } }, () => shareLink("T", "u2", toast));
  assert.deepEqual(copied, ["u2"]);
  assert.deepEqual(toasts, [{ message: "Link copied." }]);
  await stubNavigator({}, () => shareLink("T", "u", toast));
  assert.equal(toasts.at(-1)?.kind, "error");
  await assert.rejects(stubNavigator({ share: async () => { throw new TypeError("boom"); } }, () => shareLink("T", "u", toast)), TypeError);
});

test("every card keeps its actions in the footer's right-hand cluster, after the like and comment buttons", () => {
  const cluster = (html: string) => html.slice(html.indexOf("ml-auto flex items-center gap-1"));
  const tournament = cluster(card(publishedTournament));
  assert.ok(tournament.indexOf('aria-label="Save"') > 0 && tournament.indexOf('aria-label="Save"') < tournament.indexOf("Share"));
  assert.ok(card(publishedTournament).indexOf('aria-label="Like') < card(publishedTournament).indexOf("ml-auto flex items-center gap-1"));
  const book = cluster(card(finishedReading));
  assert.match(book, />Want to read<\/button>[\s\S]*Share/);
  assert.doesNotMatch(book, /aria-label="Save"/);
  const mural = cluster(card(publishedMural));
  assert.match(mural, /aria-label="Save"/);
  assert.doesNotMatch(mural, /Share/);
  assert.doesNotMatch(card(publishedTournament).slice(0, card(publishedTournament).indexOf("ml-auto flex items-center gap-1")), /aria-label="Save"/);
});

test("a mural card names the mural and shows its cover when it has one", () => {
  assert.match(card(publishedMural), /<a[^>]*>My wall<\/a>/);
  const withCover = card({ ...publishedMural, mural: { ...publishedMural.mural, coverImageUrl: "wall.png" } });
  assert.match(withCover, /<img src="wall\.png"/);
  assert.doesNotMatch(card(publishedMural), /<img/);
});
