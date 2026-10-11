import assert from "node:assert/strict";
import { test } from "node:test";
import { bookMetaLine, bookScreenModel } from "./bookScreen.js";
import type { WorkPage } from "./types.js";

const edition = (n: number) => ({ bookId: `e${n}`, title: "Dune", language: "en", year: 1965 + n, isbn: null, mine: n === 1 });
function page(overrides: Partial<WorkPage["work"]> = {}): WorkPage {
  return {
    work: { id: "w", title: "Dune", author: "Frank Herbert", summary: "Spice.", coverUrl: null, coverColor: null, editions: [1, 2, 3, 4, 5].map(edition), genres: ["Science Fiction"], rating: { value: 4.27, count: 2310 }, year: 1965, pages: 412, ...overrides },
    mine: null,
    readers: { followed: [{ username: "ana", avatarUrl: null, readStatus: 2, published: false }], others: [{ username: "bo", avatarUrl: null, readStatus: 1, published: true }], counts: { readers: 2, finished: 1 } },
    games: { tierlists: [{ id: "t", name: "Best SF", owner: "app", path: "/vote/abc" }], arenas: [], quizzes: [] }
  };
}
const owned = (extra: Record<string, unknown> = {}) => ({ Title: "Dune (mine)", Attribution: "F. Herbert", ReadStatus: 1, highlights: [{ BookmarkID: "h1", Text: "Fear is the mind-killer." }, { BookmarkID: "h2", Text: "  " }], ...extra });
const keys = (model: ReturnType<typeof bookScreenModel>) => model.tabs.map((tab) => tab.key);

test("owner: status control, three tabs, style and cover in the menu", () => {
  const model = bookScreenModel(page(), owned(), { isAdmin: false });
  assert.equal(model.primary, "owner");
  assert.deepEqual(keys(model), ["about", "highlights", "community"]);
  assert.deepEqual(model.tabs.map((tab) => tab.label), ["About", "Highlights (1)", "Community (2)"]);
  assert.deepEqual(model.menu, ["style", "cover"]);
  assert.equal(model.status!.label, "Reading");
  assert.deepEqual(model.status!.options.map((o) => [o.label, o.selected]), [["To read", false], ["Reading", true], ["Finished", false]]);
  assert.equal(model.feeling, null);
  assert.equal(model.highlights.length, 1);
});

test("finished owner gets a feeling control, unset reads as a question", () => {
  const unset = bookScreenModel(page(), owned({ ReadStatus: 2 }), { isAdmin: false });
  assert.equal(unset.feeling!.label, "How did it land?");
  assert.ok(unset.feeling!.options.every((o) => !o.selected));
  const loved = bookScreenModel(page(), owned({ ReadStatus: 2, Rating: 4 }), { isAdmin: false });
  assert.equal(loved.feeling!.label, "Loved it");
  assert.deepEqual(loved.feeling!.options.filter((o) => o.selected).map((o) => o.rating), [4]);
});

test("not owned: add to library, no highlights tab, no menu", () => {
  const model = bookScreenModel(page(), null, { isAdmin: false });
  assert.equal(model.primary, "add");
  assert.equal(model.status, null);
  assert.deepEqual(keys(model), ["about", "community"]);
  assert.deepEqual(model.menu, []);
});

test("an owned work whose library book is missing offers no primary action", () => {
  const model = bookScreenModel({ ...page(), mine: { bookKey: "k", readStatus: 1, rating: null, highlightCount: 0 } }, null, { isAdmin: false });
  assert.equal(model.primary, null);
});

test("a page from a backend without genres, rating, year or pages renders without them", () => {
  const { genres, rating, year, pages, ...work } = page().work;
  const model = bookScreenModel({ ...page(), work: work as WorkPage["work"] }, null, { isAdmin: false });
  assert.deepEqual(model.genres, []);
  assert.equal(model.rating, null);
  assert.equal(model.meta, null);
});

test("admins get the cover moderation items whether or not they own the book", () => {
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: true }).menu, ["rejectCover", "replaceCover"]);
  assert.deepEqual(bookScreenModel(page(), owned(), { isAdmin: true }).menu, ["style", "cover", "rejectCover", "replaceCover"]);
});

test("unresolved: hero from the library book, highlights only, no about or community", () => {
  const model = bookScreenModel(null, owned({ _genres: ["Science Fiction"] }), { isAdmin: false });
  assert.equal(model.title, "Dune (mine)");
  assert.equal(model.author, "F. Herbert");
  assert.equal(model.meta, null);
  assert.deepEqual(keys(model), ["highlights"]);
  assert.equal(model.about, null);
  assert.equal(model.community, null);
  assert.equal(model.primary, "owner");
});

test("hero and about come from the work when there is one", () => {
  const model = bookScreenModel(page(), owned(), { isAdmin: false });
  assert.equal(model.title, "Dune");
  assert.deepEqual(model.genres, ["Science Fiction"]);
  assert.deepEqual(model.about!.editionsPreview.map((e) => e.bookId), ["e1", "e2", "e3"]);
  assert.equal(model.about!.editions.length, 5);
  assert.equal(model.about!.preview, null);
});

test("community lists followed then others and the games", () => {
  const { community } = bookScreenModel(page(), null, { isAdmin: false });
  assert.equal(community!.countsLabel, "2 readers · 1 finished");
  assert.deepEqual(community!.groups.map((g) => [g.title, g.rows.map((r) => r.username)]), [["People you follow", ["ana"]], ["Other readers", ["bo"]]]);
  assert.deepEqual(community!.games.map((g) => [g.title, g.detail, g.path]), [["Best SF", "Tier list · Scripta", "/vote/abc"]]);
});

test("meta line is year and pages, dropping what is missing", () => {
  assert.equal(bookMetaLine({ year: 1965, pages: 412 }), "1965 · 412 pages");
  assert.equal(bookMetaLine({ year: null, pages: 90 }), "90 pages");
  assert.equal(bookMetaLine({ year: null, pages: 1 }), "1 page");
  assert.equal(bookMetaLine({ year: 1965, pages: null }), "1965");
  assert.equal(bookMetaLine({ year: null, pages: null }), null);
});

test("the rating is its own value with a count label, absent without one", () => {
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: false }).rating, { value: 4.27, label: "4.3 · 2.3K ratings" });
  const one = page({ rating: { value: 5, count: 1 } });
  assert.deepEqual(bookScreenModel(one, null, { isAdmin: false }).rating, { value: 5, label: "5.0 · 1 rating" });
  assert.equal(bookScreenModel(page({ rating: null }), null, { isAdmin: false }).rating, null);
});

test("reader groups are titled only when both have rows", () => {
  const base = page();
  const onlyOthers = bookScreenModel({ ...base, readers: { ...base.readers, followed: [] } }, null, { isAdmin: false });
  assert.deepEqual(onlyOthers.community!.groups.map((g) => g.title), [null]);
  const onlyFollowed = bookScreenModel({ ...base, readers: { ...base.readers, others: [] } }, null, { isAdmin: false });
  assert.deepEqual(onlyFollowed.community!.groups.map((g) => [g.title, g.rows.map((r) => [r.username, r.status, r.linksToProfile])]), [[null, [["ana", "Finished", false]]]]);
});

test("games list every kind and an empty page has none", () => {
  const base = page();
  const games = { tierlists: [], arenas: [{ id: "a1", name: "SF", owner: { username: "bo", avatarUrl: null }, path: "/arena/a1" }], quizzes: [{ id: "q1", name: "Trivia", owner: "app" as const, path: "/quiz/q1" }] };
  assert.deepEqual(bookScreenModel({ ...base, games }, null, { isAdmin: false }).community!.games, [
    { key: "arena-a1", title: "SF", detail: "Tournament · bo", path: "/arena/a1" },
    { key: "quiz-q1", title: "Trivia", detail: "Quiz · Scripta", path: "/quiz/q1" }
  ]);
  assert.deepEqual(bookScreenModel({ ...base, games: { tierlists: [], arenas: [], quizzes: [] } }, null, { isAdmin: false }).community!.games, []);
});

test("a long summary gets a preview, a short one does not", () => {
  const long = `${"Spice and sand. ".repeat(40)}The end.`;
  const preview = bookScreenModel(page({ summary: long }), null, { isAdmin: false }).about!.preview;
  assert.ok(preview && preview.endsWith("…") && !preview.includes("The end."));
  assert.equal(bookScreenModel(page({ summary: "Spice." }), null, { isAdmin: false }).about!.preview, null);
});
