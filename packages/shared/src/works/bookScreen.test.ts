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
  const model = bookScreenModel(page(), owned(), { isAdmin: false }, "en");
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
  const unset = bookScreenModel(page(), owned({ ReadStatus: 2 }), { isAdmin: false }, "en");
  assert.equal(unset.feeling!.label, "How did it land?");
  assert.ok(unset.feeling!.options.every((o) => !o.selected));
  const loved = bookScreenModel(page(), owned({ ReadStatus: 2, Rating: 4 }), { isAdmin: false }, "en");
  assert.equal(loved.feeling!.label, "Loved it");
  assert.deepEqual(loved.feeling!.options.filter((o) => o.selected).map((o) => o.rating), [4]);
});

test("not owned: add to library, no highlights tab, no menu", () => {
  const model = bookScreenModel(page(), null, { isAdmin: false }, "en");
  assert.equal(model.primary, "add");
  assert.equal(model.status, null);
  assert.deepEqual(keys(model), ["about", "community"]);
  assert.deepEqual(model.menu, []);
});

test("an owned work whose library book is missing offers no primary action", () => {
  const model = bookScreenModel({ ...page(), mine: { bookKey: "k", readStatus: 1, rating: null, highlightCount: 0 } }, null, { isAdmin: false }, "en");
  assert.equal(model.primary, null);
});

test("a page from a backend without genres, rating, year or pages renders without them", () => {
  const { genres, rating, year, pages, ...work } = page().work;
  const model = bookScreenModel({ ...page(), work: work as WorkPage["work"] }, null, { isAdmin: false }, "en");
  assert.deepEqual(model.genres, []);
  assert.equal(model.rating, null);
  assert.equal(model.meta, null);
});

test("admins get the cover moderation items whether or not they own the book", () => {
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: true }, "en").menu, ["rejectCover", "replaceCover"]);
  assert.deepEqual(bookScreenModel(page(), owned(), { isAdmin: true }, "en").menu, ["style", "cover", "rejectCover", "replaceCover"]);
});

test("unresolved: hero from the library book, highlights only, no about or community", () => {
  const model = bookScreenModel(null, owned({ _genres: ["Science Fiction"] }), { isAdmin: false }, "en");
  assert.equal(model.title, "Dune (mine)");
  assert.equal(model.author, "F. Herbert");
  assert.equal(model.meta, null);
  assert.deepEqual(keys(model), ["highlights"]);
  assert.equal(model.about, null);
  assert.equal(model.community, null);
  assert.equal(model.primary, "owner");
});

test("hero and about come from the work when there is one", () => {
  const model = bookScreenModel(page(), owned(), { isAdmin: false }, "en");
  assert.equal(model.title, "Dune");
  assert.deepEqual(model.genres, ["Science Fiction"]);
  assert.deepEqual(model.about!.editionsPreview.map((e) => e.bookId), ["e1", "e2", "e3"]);
  assert.equal(model.about!.editions.length, 5);
  assert.equal(model.about!.preview, null);
});

test("community lists followed then others and the games", () => {
  const { community } = bookScreenModel(page(), null, { isAdmin: false }, "en");
  assert.equal(community!.countsLabel, "2 readers · 1 finished");
  assert.deepEqual(community!.groups.map((g) => [g.title, g.rows.map((r) => r.username)]), [["People you follow", ["ana"]], ["Other readers", ["bo"]]]);
  assert.deepEqual(community!.games.map((g) => [g.title, g.detail, g.path]), [["Best SF", "Tier list · Atmyshelf", "/vote/abc"]]);
});

test("meta line is year and pages, dropping what is missing", () => {
  assert.equal(bookMetaLine({ year: 1965, pages: 412 }, "en"), "1965 · 412 pages");
  assert.equal(bookMetaLine({ year: null, pages: 90 }, "en"), "90 pages");
  assert.equal(bookMetaLine({ year: null, pages: 1 }, "en"), "1 page");
  assert.equal(bookMetaLine({ year: 1965, pages: null }, "en"), "1965");
  assert.equal(bookMetaLine({ year: null, pages: null }, "en"), null);
});

test("the rating is its own value with a count label, absent without one", () => {
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: false }, "en").rating, { value: 4.27, label: "4.3 · 2.3K ratings" });
  const one = page({ rating: { value: 5, count: 1 } });
  assert.deepEqual(bookScreenModel(one, null, { isAdmin: false }, "en").rating, { value: 5, label: "5.0 · 1 rating" });
  assert.equal(bookScreenModel(page({ rating: null }), null, { isAdmin: false }, "en").rating, null);
});

test("reader groups are titled only when both have rows", () => {
  const base = page();
  const onlyOthers = bookScreenModel({ ...base, readers: { ...base.readers, followed: [] } }, null, { isAdmin: false }, "en");
  assert.deepEqual(onlyOthers.community!.groups.map((g) => g.title), [null]);
  const onlyFollowed = bookScreenModel({ ...base, readers: { ...base.readers, others: [] } }, null, { isAdmin: false }, "en");
  assert.deepEqual(onlyFollowed.community!.groups.map((g) => [g.title, g.rows.map((r) => [r.username, r.status, r.linksToProfile])]), [[null, [["ana", "Finished", false]]]]);
});

test("games list every kind and an empty page has none", () => {
  const base = page();
  const games = { tierlists: [], arenas: [{ id: "a1", name: "SF", owner: { username: "bo", avatarUrl: null }, path: "/arena/a1" }], quizzes: [{ id: "q1", name: "Trivia", owner: "app" as const, path: "/quiz/q1" }] };
  assert.deepEqual(bookScreenModel({ ...base, games }, null, { isAdmin: false }, "en").community!.games, [
    { key: "arena-a1", title: "SF", detail: "Tournament · bo", path: "/arena/a1" },
    { key: "quiz-q1", title: "Trivia", detail: "Quiz · Atmyshelf", path: "/quiz/q1" }
  ]);
  assert.deepEqual(bookScreenModel({ ...base, games: { tierlists: [], arenas: [], quizzes: [] } }, null, { isAdmin: false }, "en").community!.games, []);
});

test("a long summary gets a preview, a short one does not", () => {
  const long = `${"Spice and sand. ".repeat(40)}The end.`;
  const preview = bookScreenModel(page({ summary: long }), null, { isAdmin: false }, "en").about!.preview;
  assert.ok(preview && preview.endsWith("…") && !preview.includes("The end."));
  assert.equal(bookScreenModel(page({ summary: "Spice." }), null, { isAdmin: false }, "en").about!.preview, null);
});

const editions = (count: number, mineAt = -1): WorkPage["work"]["editions"] => Array.from({ length: count }, (_, i) => ({
  bookId: `e${i}`, title: `Dune ${i}`, language: i === 0 ? null : "pt-BR", year: i === 0 ? null : 2000 + i, isbn: i === 0 ? null : `isbn${i}`, coverUrl: `cover:${i}`, coverColor: `#00000${i}`, pages: i === 2 ? 300 : null, mine: i === mineAt
}));
const viewer = { isAdmin: false };

test("default view has the work cover and picks the edition index from mine, then the matching cover, then the first", () => {
  const withMine = bookScreenModel(page({ editions: editions(5, 3), coverUrl: "cover:1" }), null, viewer, "en");
  assert.deepEqual(withMine.cover, { url: "cover:1", color: null });
  assert.deepEqual(withMine.edition, { index: 3, count: 5, label: "Your edition · 4 of 5", showDots: true, mineIndex: 3 });
  assert.deepEqual(bookScreenModel(page({ editions: editions(5), coverUrl: "cover:2" }), null, viewer, "en").edition, { index: 2, count: 5, label: "Edition 3 of 5", showDots: true, mineIndex: null });
  assert.equal(bookScreenModel(page({ editions: editions(5), coverUrl: "cover:x" }), null, viewer, "en").edition!.index, 0);
  assert.equal(bookScreenModel(page({ editions: editions(5), coverUrl: null }), null, viewer, "en").edition!.index, 0);
  assert.deepEqual(bookScreenModel(null, owned(), viewer, "en").cover, { url: null, color: null });
});

test("a selected edition overrides the hero and the add-book details but not the owner controls, about or community", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:1", coverColor: "#abc" });
  const base = bookScreenModel(p, owned({ ReadStatus: 2, Rating: 4 }), viewer, "en", null);
  const picked = bookScreenModel(p, owned({ ReadStatus: 2, Rating: 4 }), viewer, "en", "e2");
  assert.equal(picked.title, "Dune 2");
  assert.equal(picked.meta, "2002 · 300 pages · pt-BR");
  assert.deepEqual(picked.cover, { url: "cover:2", color: "#000002" });
  assert.deepEqual(picked.edition, { index: 2, count: 5, label: "Edition 3 of 5", showDots: true, mineIndex: 1 });
  const sameAsDefault = (model: typeof base) => ({ ...model, title: "", year: null, meta: null, cover: base.cover, edition: null });
  assert.deepEqual(sameAsDefault(picked), sameAsDefault(base));
});

test("selecting the default edition is the default view, so going back restores it exactly", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:3", coverColor: "#abc" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "en", "e1"), bookScreenModel(p, owned(), viewer, "en"));
  assert.deepEqual(bookScreenModel(p, null, { isAdmin: true }, "en", "e1"), bookScreenModel(p, null, { isAdmin: true }, "en"));
});

test("an edition id that is not one of the work's editions leaves the default view", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:3", coverColor: "#abc" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "en", "other-work-edition"), bookScreenModel(p, owned(), viewer, "en"));
  assert.deepEqual(bookScreenModel(p, null, { isAdmin: true }, "en", ""), bookScreenModel(p, null, { isAdmin: true }, "en"));
});

test("an owned book matching no edition is shown at the default edition, so it keeps its own cover", () => {
  const p = page({ editions: editions(5), coverUrl: "cover:2" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "en").edition, { index: 2, count: 5, label: "Your edition · 3 of 5", showDots: true, mineIndex: 2 });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "en", "e2"), bookScreenModel(p, owned(), viewer, "en"));
  const away = bookScreenModel(p, owned(), viewer, "en", "e4").edition!;
  assert.deepEqual([away.index, away.label, away.mineIndex], [4, "Edition 5 of 5", 2]);
  assert.equal(bookScreenModel(p, null, viewer, "en").edition!.mineIndex, null);
});

test("admin cover tools hide while another edition is shown, since they act on the default cover", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:1" });
  assert.deepEqual(bookScreenModel(p, owned(), { isAdmin: true }, "en", null).menu, ["style", "cover", "rejectCover", "replaceCover"]);
  assert.deepEqual(bookScreenModel(p, owned(), { isAdmin: true }, "en", "e2").menu, ["style", "cover"]);
  assert.deepEqual(bookScreenModel(p, null, { isAdmin: true }, "en", "e2").menu, []);
});

test("selecting an edition without a cover shows the placeholder, and without year, pages or language has no meta", () => {
  const p = page({ editions: [{ ...editions(1)[0]!, coverUrl: null, coverColor: null }, ...editions(3).slice(1)], coverUrl: "cover:1" });
  const picked = bookScreenModel(p, null, viewer, "en", "e0");
  assert.deepEqual(picked.cover, { url: null, color: null });
  assert.equal(picked.meta, null);
});

test("add book defaults to the displayed edition and the work cover, and follows the selected edition", () => {
  const p = page({ editions: editions(4), coverUrl: "cover:3" });
  assert.deepEqual(bookScreenModel(p, null, viewer, "en").addBook, { title: "Dune", author: "Frank Herbert", isbn: "isbn3", coverUrl: "cover:3" });
  assert.deepEqual(bookScreenModel(p, null, viewer, "en", "e2").addBook, { title: "Dune", author: "Frank Herbert", isbn: "isbn2", coverUrl: "cover:2" });
  assert.deepEqual(bookScreenModel(p, null, viewer, "en", "e0").addBook, { title: "Dune", author: "Frank Herbert", isbn: null, coverUrl: "cover:0" });
  assert.equal(bookScreenModel(page({ editions: editions(1).map((e) => ({ ...e, isbn: null })) }), null, viewer, "en").addBook!.isbn, null);
  assert.equal(bookScreenModel(p, owned(), viewer, "en").addBook, null);
  assert.equal(bookScreenModel({ ...p, mine: { bookKey: "k", readStatus: 1, rating: null, highlightCount: 0 } }, null, viewer, "en", "e2").addBook, null);
  assert.equal(bookScreenModel(null, null, viewer, "en").addBook, null);
});

test("edition dots show up to seven editions", () => {
  assert.equal(bookScreenModel(page({ editions: editions(7) }), null, viewer, "en").edition!.showDots, true);
  assert.equal(bookScreenModel(page({ editions: editions(8) }), null, viewer, "en").edition!.showDots, false);
  assert.equal(bookScreenModel(page({ editions: editions(12) }), null, viewer, "en", "e2").edition!.label, "Edition 3 of 12");
});

test("an unknown edition id is the default view", () => {
  const p = page({ editions: editions(5, 1), coverUrl: "cover:1" });
  assert.deepEqual(bookScreenModel(p, owned(), viewer, "en", "nope"), bookScreenModel(p, owned(), viewer, "en"));
});

test("possible genres pass through, and a page from a backend without them gives none", () => {
  assert.deepEqual(bookScreenModel(page({ possibleGenres: ["History"] }), null, { isAdmin: false }, "en").possibleGenres, ["History"]);
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: false }, "en").possibleGenres, []);
  assert.deepEqual(bookScreenModel(null, owned(), { isAdmin: false }, "en").possibleGenres, []);
});

test("one edition or no page has no edition strip", () => {
  assert.equal(bookScreenModel(page({ editions: editions(1) }), null, viewer, "en", "e0").edition, null);
  assert.equal(bookScreenModel(page({ editions: [] }), null, viewer, "en").edition, null);
  assert.equal(bookScreenModel(null, owned(), viewer, "en").edition, null);
});

const series = { name: "Malazan Book of the Fallen", kind: "series" as const, position: "3" };
const collection = { name: "Bang!", kind: "collection" as const, position: "248" };

test("the work's series shows, and wins over an edition's collection", () => {
  const withCollection = editions(3).map((edition) => ({ ...edition, collection }));
  assert.deepEqual(bookScreenModel(page({ series, editions: withCollection }), null, viewer, "en").series, series);
});

test("an edition's collection shows when the work has no series", () => {
  const withCollection = editions(3).map((edition, i) => ({ ...edition, collection: i === 1 ? collection : null }));
  assert.equal(bookScreenModel(page({ editions: withCollection }), null, viewer, "en").series, null);
  assert.deepEqual(bookScreenModel(page({ series: null, editions: withCollection, coverUrl: "cover:1" }), null, viewer, "en").series, collection);
});

test("the collection comes from the edition being shown", () => {
  const other = { name: "Clássicos", kind: "collection" as const, position: null };
  const withCollections = editions(3).map((edition, i) => ({ ...edition, collection: i === 0 ? collection : i === 2 ? other : null }));
  const p = page({ editions: withCollections, coverUrl: "cover:0" });
  assert.deepEqual(bookScreenModel(p, null, viewer, "en").series, collection);
  assert.deepEqual(bookScreenModel(p, null, viewer, "en", "e2").series, other);
  assert.equal(bookScreenModel(p, null, viewer, "en", "e1").series, null);
});

test("no series, no collection and no page all read as null", () => {
  assert.equal(bookScreenModel(page(), null, viewer, "en").series, null);
  assert.equal(bookScreenModel(page({ editions: [] }), null, viewer, "en").series, null);
  assert.equal(bookScreenModel(null, owned(), viewer, "en").series, null);
});

const hugo = { prize: "hugo-novel", year: 1993, won: true };
const bookerNominee = { prize: "booker", year: 2019, won: false };
const nobel = { prize: "nobel-literature", year: 1998, won: true };
const camoes = { prize: "camoes", year: 1995, won: true };

test("awards lists book prizes as labelled pills, wins first", () => {
  const nebula = { prize: "nebula-novel", year: 1994, won: true };
  const model = bookScreenModel(page({ awards: [bookerNominee, hugo, nebula] }), null, viewer, "en");
  assert.deepEqual(model.awards, [
    { label: "Nebula Award 1994", won: true },
    { label: "Hugo Award 1993", won: true },
    { label: "Booker Prize 2019 · nominee", won: false }
  ]);
});

test("authorAwards joins author prizes and leaves them out of awards", () => {
  const model = bookScreenModel(page({ awards: [camoes, hugo, nobel] }), null, viewer, "en");
  assert.equal(model.authorAwards, "Nobel Prize in Literature 1998 · Prémio Camões 1995");
  assert.deepEqual(model.awards, [{ label: "Hugo Award 1993", won: true }]);
  assert.equal(bookScreenModel(page({ awards: [hugo] }), null, viewer, "en").authorAwards, null);
});

test("unknown prizes are dropped", () => {
  const model = bookScreenModel(page({ awards: [{ prize: "goodreads-choice", year: 2020, won: true }, hugo] }), null, viewer, "en");
  assert.deepEqual(model.awards, [{ label: "Hugo Award 1993", won: true }]);
  assert.equal(model.authorAwards, null);
});

test("a page without awards has none", () => {
  for (const model of [bookScreenModel(page(), null, viewer, "en"), bookScreenModel(page({ awards: [] }), null, viewer, "en"), bookScreenModel(null, owned(), viewer, "en")]) {
    assert.deepEqual(model.awards, []);
    assert.equal(model.authorAwards, null);
  }
});

test("characters split after eight", () => {
  const characters = Array.from({ length: 11 }, (_, i) => `Person ${i + 1}`);
  const model = bookScreenModel(page({ characters }), null, viewer, "en");
  assert.equal(model.characters.shown.length, 8);
  assert.equal(model.characters.more.length, 3);
  assert.equal(model.characters.more[0], "Person 9");
});

test("a page without characters has none", () => {
  for (const model of [bookScreenModel(page(), null, viewer, "en"), bookScreenModel(null, owned(), viewer, "en")]) {
    assert.deepEqual(model.characters, { shown: [], more: [], canMakeGame: false });
  }
});

test("canMakeGame needs four character names", () => {
  assert.equal(bookScreenModel(page({ characters: ["A", "B", "C"] }), null, viewer, "en").characters.canMakeGame, false);
  assert.equal(bookScreenModel(page({ characters: ["A", "B", "C", "D"] }), null, viewer, "en").characters.canMakeGame, true);
});

test("year is the displayed edition's, falling back to the work's", () => {
  assert.equal(bookScreenModel(page(), null, viewer, "en").year, 1966);
  assert.equal(bookScreenModel(page(), null, viewer, "en", "e3").year, 1968);
  assert.equal(bookScreenModel(page({ editions: editions(5), coverUrl: null }), null, viewer, "en").year, 1965);
  assert.equal(bookScreenModel(page({ editions: editions(5), coverUrl: null }), null, viewer, "en", "e2").year, 2002);
  assert.equal(bookScreenModel(page({ editions: editions(5), coverUrl: null, year: null }), null, viewer, "en").year, null);
  assert.equal(bookScreenModel(null, { Title: "Loose" }, viewer, "en").year, null);
});

test("add book falls back to the first edition with an isbn when the displayed edition has none", () => {
  const noIsbn = editions(4).map((e) => (e.bookId === "e2" ? { ...e, isbn: null } : e));
  assert.equal(bookScreenModel(page({ editions: noIsbn, coverUrl: "cover:2" }), null, viewer, "en").addBook!.isbn, "isbn1");
  assert.equal(bookScreenModel(page({ editions: noIsbn, coverUrl: "cover:3" }), null, viewer, "en").addBook!.isbn, "isbn3");
  assert.equal(bookScreenModel(page({ editions: noIsbn, coverUrl: "cover:2" }), null, viewer, "en", "e2").addBook!.isbn, null);
});
