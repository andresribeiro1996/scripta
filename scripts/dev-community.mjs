#!/usr/bin/env node
// The social graph the dev account needs before Home's Activity tab shows
// anything: published profiles, follows in both directions, and one event
// of each kind the feed can render.
//
// Seeding the accounts is not enough on its own. A dashboard feed is built
// from the events of people the viewer FOLLOWS, and an unpublished profile
// opens only as a "This profile is private" page, with no Follow button,
// Activity or Library, and no place in People's suggestions — so a fixture
// that stops at "three users exist" leaves the tab permanently empty and
// looks like a broken feature.
//
// Runs after dev-account.mjs and three-users.mjs (see devFixtureSetup.mjs),
// against whatever backend/data/dev/ the *_DB_PATH vars point at. Idempotent:
// every step checks for its own result first, so re-running adds nothing.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_EMAIL, DEV_PASSWORD, DEV_USERNAME, ensureBackendEnv } from "./dev-account.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_PASSWORD = "scripta123";

function log(message) {
  console.log(`[dev-community] ${message}`);
}

// config/env.ts runs `dotenv/config` at import time and dotenv reads the
// CWD's .env, so backend/ has to be both populated and the cwd before the
// app is imported — the same dance, for the same reason, as dev-account.mjs.
ensureBackendEnv();
process.chdir(join(repoRoot, "backend"));

const { buildApp } = await import("../backend/src/app.ts");
const app = buildApp();
await app.ready();

async function call(method, url, payload, token, expected = [200, 201, 204]) {
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!expected.includes(response.statusCode)) {
    throw new Error(`${method} ${url} → ${response.statusCode}: ${response.body}`);
  }
  return response.body ? response.json() : null;
}

async function signIn(identifier, password) {
  const session = await call("POST", "/auth/login", { identifier, password });
  return { id: session.user.id, username: session.user.username, token: session.accessToken };
}

/** Publishing doesn't need a mural, but the shelf is what a visitor sees, so
 *  each account gets its first mural (created if it has none) as that shelf —
 *  including the dev account, which dev-account.mjs deliberately seeds with a
 *  library and nothing else. */
async function ensurePublishedProfile(user) {
  const { published } = await call("GET", "/community/profile", undefined, user.token);
  if (published) return;
  const murals = await call("GET", "/murals", undefined, user.token);
  const mural = murals.length ? murals[0] : await call("POST", "/murals", { name: `${user.username}'s reading room` }, user.token);
  await call("PUT", "/community/profile/publish", { muralId: mural.id }, user.token);
  log(`Published ${user.username}'s profile.`);
}

async function ensureFollows(follower, followee) {
  // 409 is "already following" — the idempotent case, not a failure.
  const response = await app.inject({ method: "POST", url: "/community/follows", payload: { userId: followee.id }, headers: { authorization: `Bearer ${follower.token}` } });
  if (![200, 201, 204, 409].includes(response.statusCode)) {
    throw new Error(`${follower.username} → ${followee.username}: ${response.statusCode} ${response.body}`);
  }
}

const FINISHED_BOOK = { title: "Piranesi", author: "Susanna Clarke", isbn: "9781635575637" };
const SHARED_BOOKS = [
  { title: "The Fellowship of the Ring", author: "J.R.R. Tolkien", isbn: "9780544003415" },
  { title: "The Two Towers", author: "J.R.R. Tolkien", isbn: "9780544003423" }
];

async function resolveCoverUrl(user, isbn) {
  const resolved = await app.inject({ method: "GET", url: `/covers/resolve?isbn=${isbn}`, headers: { authorization: `Bearer ${user.token}` } });
  return resolved.statusCode === 200 ? resolved.json().url : null;
}

/** Reading is the one category that is off by default, so a book_finished
 *  event from someone who never turned it on is stored but never reaches a
 *  follower's inbox — the fixture would look broken twice over.
 *
 *  Adding the book and finishing it are two calls because POST
 *  /library/books emits book_added for a book it has never seen and
 *  book_finished only for one it matches — and the cover has to ride in on
 *  the first call, since the finished event's payload is built from the
 *  stored book rather than from its request. */
async function ensureReadingEvent(user) {
  const { feedSettings } = await call("GET", "/community/profile", undefined, user.token);
  await call("PUT", "/community/profile/feed-settings", { ...feedSettings, publications: true, reading: true, votes: true, follows: true }, user.token);
  const books = (await call("GET", "/library", undefined, user.token)).data?.books ?? [];
  const existing = books.find((book) => book.Title === FINISHED_BOOK.title);
  if (existing?.ReadStatus === 2) return;
  if (!existing) {
    const coverUrl = await resolveCoverUrl(user, FINISHED_BOOK.isbn);
    await call("POST", "/library/books", { ...FINISHED_BOOK, readStatus: 0, ...(coverUrl ? { coverUrl } : {}) }, user.token);
  }
  await call("POST", "/library/books", { ...FINISHED_BOOK, readStatus: 2 }, user.token);
  log(`${user.username} finished "${FINISHED_BOOK.title}".`);
}

async function ensureSharedBooks(user) {
  const owned = new Set(((await call("GET", "/library", undefined, user.token)).data?.books ?? []).map((book) => book.Title));
  const missing = SHARED_BOOKS.filter((book) => !owned.has(book.title));
  for (const book of missing) {
    const coverUrl = await resolveCoverUrl(user, book.isbn);
    await call("POST", "/library/books", { ...book, readStatus: 2, ...(coverUrl ? { coverUrl } : {}) }, user.token);
  }
  if (missing.length) log(`${user.username} added ${missing.map((book) => `"${book.title}"`).join(" and ")}.`);
}

try {
  const dev = await signIn(DEV_EMAIL, DEV_PASSWORD);
  const alice = await signIn("fixture_alice", FIXTURE_PASSWORD);
  const bob = await signIn("fixture_bob", FIXTURE_PASSWORD);
  const charlie = await signIn("fixture_charlie", FIXTURE_PASSWORD);

  for (const user of [dev, alice, bob, charlie]) await ensurePublishedProfile(user);

  // The dev account follows the two accounts that publish and vote, so their
  // events reach its feed; alice follows back so the feed also has the one
  // row type that is about the viewer rather than about content.
  await ensureFollows(dev, alice);
  await ensureFollows(dev, bob);
  await ensureFollows(alice, dev);
  // Charlie follows the dev account and is NOT followed back, which is the
  // only state that shows a follow row's Follow back action. Alice's mutual
  // follow can't: there is nothing left to offer once it is reciprocated.
  await ensureFollows(charlie, dev);

  await ensureReadingEvent(alice);
  await ensureSharedBooks(charlie);

  log(`${DEV_USERNAME} follows fixture_alice and fixture_bob, and fixture_alice follows back.`);
  await app.close();
} catch (error) {
  await app.close();
  throw error;
}
