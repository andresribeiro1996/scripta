import assert from "node:assert/strict";
import { test } from "node:test";
import { bookMetaLine, bookScreenModel } from "./bookScreen.js";
import type { WorkPage } from "./types.js";

const edition = (n: number) => ({ bookId: `e${n}`, title: "Dune", language: "en", year: 1965 + n, isbn: null, coverUrl: null, coverColor: null, pages: null, mine: n === 1 });
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
  assert.deepEqual(community!.games.map((g) => [g.title, g.detail, g.path]), [["Best SF", "Tier list · Atmyshelf", "/vote/abc"]]);
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
    { key: "quiz-q1", title: "Trivia", detail: "Quiz · Atmyshelf", path: "/quiz/q1" }
  ]);
  assert.deepEqual(bookScreenModel({ ...base, games: { tierlists: [], arenas: [], quizzes: [] } }, null, { isAdmin: false }).community!.games, []);
});

test("a long summary gets a preview, a short one does not", () => {
  const long = `${"Spice and sand. ".repeat(40)}The end.`;
  const preview = bookScreenModel(page({ summary: long }), null, { isAdmin: false }).about!.preview;
  assert.ok(preview && preview.endsWith("…") && !preview.includes("The end."));
  assert.equal(bookScreenModel(page({ summary: "Spice." }), null, { isAdmin: false }).about!.preview, null);
});

const editions = (count: number, mineAt = -1): WorkPage["work"]["editions"] => Array.from({ length: count }, (_, i) => ({
  bookId: `e${i}`, title: `Dune ${i}`, language: i === 0 ? null : "pt-BR", year: i === 0 ? null : 2000 + i, isbn: i === 0 ? null : `isbn${i}`, coverUrl: `cover:${i}`, coverColor: `#00000${i}`, pages: i === 2 ? 300 : null, mine: i === mineAt
}));
const viewer = { isAdmin: false };

test("default view has the work cover and picks the edition index from mine, then the matching cover, then the first", () => {
  const withMine = bookScreenModel(page({ editions: editions(5, 3), coverUrl: "cover:1" }), null, viewer);
  assert.deepEqual(withMine.cover, { url: "cover:1", color: null });
  assert.deepEqual(withMine.edition, { index: 3, count: 5, label: "Your edition · 4 of 5", showDots: true, mineIndex: 3 });
  assert.deepEqual(bookScreenModel(page({ editions: editions(5), coverUrl: "cover:2" }), null, viewer).edition, { index: 2, count: 5, label: "Edition 3 of 5", showDots: true, mineIndex: null });
  assert.equal(bookScreenModel(page({ editions: editions(5), coverUrl: "cover:x" }), null, viewer).edition!.index, 0);
  assert.equal(bookScreenModel(page({ editions: editions(5), coverUrl: null }), null, viewer).edition!.index, 0);
  assert.deepEqual(bookScreenModel(null, owned(), viewer).cover, { url: null, color: null });
});

test("a selected edition overrides the hero and the add-book details but not the owner controls, about or community", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:1", coverColor: "#abc" });
  const base = bookScreenModel(p, owned({ ReadStatus: 2, Rating: 4 }), viewer, null);
  const picked = bookScreenModel(p, owned({ ReadStatus: 2, Rating: 4 }), viewer, "e2");
  assert.equal(picked.title, "Dune 2");
  assert.equal(picked.meta, "2002 · 300 pages · pt-BR");
  assert.deepEqual(picked.cover, { url: "cover:2", color: "#000002" });
  assert.deepEqual(picked.edition, { index: 2, count: 5, label: "Edition 3 of 5", showDots: true, mineIndex: 1 });
  const sameAsDefault = (model: typeof base) => ({ ...model, title: "", meta: null, cover: base.cover, edition: null });
  assert.deepEqual(sameAsDefault(picked), sameAsDefault(base));
});

test("selecting the default edition is the default view, so going back restores it exactly", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:3", coverColor: "#abc" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "e1"), bookScreenModel(p, owned(), viewer));
  assert.deepEqual(bookScreenModel(p, null, { isAdmin: true }, "e1"), bookScreenModel(p, null, { isAdmin: true }));
});

test("an edition id that is not one of the work's editions leaves the default view", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:3", coverColor: "#abc" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "other-work-edition"), bookScreenModel(p, owned(), viewer));
  assert.deepEqual(bookScreenModel(p, null, { isAdmin: true }, ""), bookScreenModel(p, null, { isAdmin: true }));
});

test("an owned book matching no edition is shown at the default edition, so it keeps its own cover", () => {
  const p = page({ editions: editions(5), coverUrl: "cover:2" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer).edition, { index: 2, count: 5, label: "Your edition · 3 of 5", showDots: true, mineIndex: 2 });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "e2"), bookScreenModel(p, owned(), viewer));
  const away = bookScreenModel(p, owned(), viewer, "e4").edition!;
  assert.deepEqual([away.index, away.label, away.mineIndex], [4, "Edition 5 of 5", 2]);
  assert.equal(bookScreenModel(p, null, viewer).edition!.mineIndex, null);
});

test("admin cover tools hide while another edition is shown, since they act on the default cover", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:1" });
  assert.deepEqual(bookScreenModel(p, owned(), { isAdmin: true }, null).menu, ["style", "cover", "rejectCover", "replaceCover"]);
  assert.deepEqual(bookScreenModel(p, owned(), { isAdmin: true }, "e2").menu, ["style", "cover"]);
  assert.deepEqual(bookScreenModel(p, null, { isAdmin: true }, "e2").menu, []);
});

test("selecting an edition without a cover shows the placeholder, and without year, pages or language has no meta", () => {
  const p = page({ editions: [{ ...editions(1)[0]!, coverUrl: null, coverColor: null }, ...editions(3).slice(1)], coverUrl: "cover:1" });
  const picked = bookScreenModel(p, null, viewer, "e0");
  assert.deepEqual(picked.cover, { url: null, color: null });
  assert.equal(picked.meta, null);
});

test("add book defaults to the first edition with an isbn and the work cover, and follows the selected edition", () => {
  const p = page({ editions: editions(4), coverUrl: "cover:3" });
  assert.deepEqual(bookScreenModel(p, null, viewer).addBook, { title: "Dune", author: "Frank Herbert", isbn: "isbn1", coverUrl: "cover:3" });
  assert.deepEqual(bookScreenModel(p, null, viewer, "e2").addBook, { title: "Dune", author: "Frank Herbert", isbn: "isbn2", coverUrl: "cover:2" });
  assert.deepEqual(bookScreenModel(p, null, viewer, "e0").addBook, { title: "Dune", author: "Frank Herbert", isbn: null, coverUrl: "cover:0" });
  assert.equal(bookScreenModel(page({ editions: editions(1).map((e) => ({ ...e, isbn: null })) }), null, viewer).addBook!.isbn, null);
  assert.equal(bookScreenModel(p, owned(), viewer).addBook, null);
  assert.equal(bookScreenModel({ ...p, mine: { bookKey: "k", readStatus: 1, rating: null, highlightCount: 0 } }, null, viewer, "e2").addBook, null);
  assert.equal(bookScreenModel(null, null, viewer).addBook, null);
});

test("edition dots show up to seven editions", () => {
  assert.equal(bookScreenModel(page({ editions: editions(7) }), null, viewer).edition!.showDots, true);
  assert.equal(bookScreenModel(page({ editions: editions(8) }), null, viewer).edition!.showDots, false);
  assert.equal(bookScreenModel(page({ editions: editions(12) }), null, viewer, "e2").edition!.label, "Edition 3 of 12");
});

test("an unknown edition id is the default view", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:1" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "nope"), bookScreenModel(p, owned(), viewer));
});

test("possible genres pass through, and a page from a backend without them gives none", () => {
  assert.deepEqual(bookScreenModel(page({ possibleGenres: ["History"] }), null, { isAdmin: false }).possibleGenres, ["History"]);
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: false }).possibleGenres, []);
  assert.deepEqual(bookScreenModel(null, owned(), { isAdmin: false }).possibleGenres, []);
});

test("one edition or no page has no edition strip", () => {
  assert.equal(bookScreenModel(page({ editions: editions(1) }), null, viewer, "e0").edition, null);
  assert.equal(bookScreenModel(page({ editions: [] }), null, viewer).edition, null);
  assert.equal(bookScreenModel(null, owned(), viewer).edition, null);
});

const series = { name: "Malazan Book of the Fallen", kind: "series" as const, position: "3" };
const collection = { name: "Bang!", kind: "collection" as const, position: "248" };

test("the work's series shows, and wins over an edition's collection", () => {
  const withCollection = editions(3).map((edition) => ({ ...edition, collection }));
  assert.deepEqual(bookScreenModel(page({ series, editions: withCollection }), null, viewer).series, series);
});

test("an edition's collection shows when the work has no series", () => {
  const withCollection = editions(3).map((edition, i) => ({ ...edition, collection: i === 1 ? collection : null }));
  assert.equal(bookScreenModel(page({ editions: withCollection }), null, viewer).series, null);
  assert.deepEqual(bookScreenModel(page({ series: null, editions: withCollection, coverUrl: "cover:1" }), null, viewer).series, collection);
});

test("the collection comes from the edition being shown", () => {
  const other = { name: "Clássicos", kind: "collection" as const, position: null };
  const withCollections = editions(3).map((edition, i) => ({ ...edition, collection: i === 0 ? collection : i === 2 ? other : null }));
  const p = page({ editions: withCollections, coverUrl: "cover:0" });
  assert.deepEqual(bookScreenModel(p, null, viewer).series, collection);
  assert.deepEqual(bookScreenModel(p, null, viewer, "e2").series, other);
  assert.equal(bookScreenModel(p, null, viewer, "e1").series, null);
});

test("no series, no collection and no page all read as null", () => {
  assert.equal(bookScreenModel(page(), null, viewer).series, null);
  assert.equal(bookScreenModel(page({ editions: [] }), null, viewer).series, null);
  assert.equal(bookScreenModel(null, owned(), viewer).series, null);
});

const hugo = { prize: "hugo-novel", year: 1993, won: true };
const bookerNominee = { prize: "booker", year: 2019, won: false };
const nobel = { prize: "nobel-literature", year: 1998, won: true };
const camoes = { prize: "camoes", year: 1995, won: true };

test("awards lists book prizes as labelled pills, wins first", () => {
  const nebula = { prize: "nebula-novel", year: 1994, won: true };
  const model = bookScreenModel(page({ awards: [bookerNominee, hugo, nebula] }), null, viewer);
  assert.deepEqual(model.awards, [
    { label: "Nebula Award 1994", won: true },
    { label: "Hugo Award 1993", won: true },
    { label: "Booker Prize 2019 · nominee", won: false }
  ]);
});

test("authorAwards joins author prizes and leaves them out of awards", () => {
  const model = bookScreenModel(page({ awards: [camoes, hugo, nobel] }), null, viewer);
  assert.equal(model.authorAwards, "Nobel Prize in Literature 1998 · Prémio Camões 1995");
  assert.deepEqual(model.awards, [{ label: "Hugo Award 1993", won: true }]);
  assert.equal(bookScreenModel(page({ awards: [hugo] }), null, viewer).authorAwards, null);
});

test("unknown prizes are dropped", () => {
  const model = bookScreenModel(page({ awards: [{ prize: "goodreads-choice", year: 2020, won: true }, hugo] }), null, viewer);
  assert.deepEqual(model.awards, [{ label: "Hugo Award 1993", won: true }]);
  assert.equal(model.authorAwards, null);
});

test("a page without awards has none", () => {
  for (const model of [bookScreenModel(page(), null, viewer), bookScreenModel(page({ awards: [] }), null, viewer), bookScreenModel(null, owned(), viewer)]) {
    assert.deepEqual(model.awards, []);
    assert.equal(model.authorAwards, null);
  }
});

test("characters split after eight", () => {
  const characters = Array.from({ length: 11 }, (_, i) => `Person ${i + 1}`);
  const model = bookScreenModel(page({ characters }), null, viewer);
  assert.equal(model.characters.shown.length, 8);
  assert.equal(model.characters.more.length, 3);
  assert.equal(model.characters.more[0], "Person 9");
});

test("a page without characters has none", () => {
  for (const model of [bookScreenModel(page(), null, viewer), bookScreenModel(null, owned(), viewer)]) {
    assert.deepEqual(model.characters, { shown: [], more: [] });
  }
});
