import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { WorksDeps } from "./service.js";

const scratch = mkdtempSync(join(tmpdir(), "works-service-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createWorksService } = await import("./service.js");

const profile = (username: string) => ({ username, avatarUrl: null });

function deps(overrides: Partial<WorksDeps> = {}): WorksDeps {
  return {
    getWorkPage: (id) => (id === "old" || id === "w" ? {
      id: "w", title: "Dune", author: "Frank Herbert", summary: null, aliasIds: ["w", "old"],
      editions: [
        { bookId: "e1", title: "Dune", language: "en", year: 1965, isbn: "9780441013593", summary: null, coverUrl: null, coverColor: null, genres: [], rating: null, ratingCount: 0, pages: null },
        { bookId: "e2", title: "Duna", language: "pt-BR", year: 2017, isbn: "9788576573135", summary: "Especiaria.", coverUrl: "cover:e2", coverColor: "#e0a82e", genres: [], rating: null, ratingCount: 0, pages: null }
      ]
    } : undefined),
    holdersOfWorks: () => [
      { userId: "viewer", readStatus: 2 }, { userId: "ana", readStatus: 1 }, { userId: "bo", readStatus: 2 },
      { userId: "nameless", readStatus: 2 }, { userId: "hidden", readStatus: 2 }, { userId: "cy", readStatus: 0 }
    ],
    copyOfWork: (userId) => (userId === "viewer" ? { bookKey: "isbn:9780441013593", readStatus: 2, rating: 4, highlightCount: 3, isbn: "978-0441013593", coverUrl: "https://c/mine.webp" } : undefined),
    readerVisibility: (viewerId, ids) => new Map(ids.flatMap((id): Array<[string, { followed: boolean; published: boolean; showGlyph: boolean }]> => {
      if (id === "ana") return viewerId === "viewer" ? [[id, { followed: true, published: false, showGlyph: false }]] : [];
      if (id === "bo" || id === "nameless" || id === "viewer") return [[id, { followed: false, published: true, showGlyph: id === "bo" }]];
      if (id === "cy") return [[id, { followed: viewerId === "viewer", published: true, showGlyph: false }]];
      return [];
    })),
    resolveProfiles: (ids) => new Map(ids.filter((id) => id !== "nameless" && id !== "deleted").map((id) => [id, profile(id)])),
    readerGlyphFor: (userId) => (userId === "bo" ? "lamp" : null),
    tierlists: () => [{ id: "t1", name: "Best SF", path: "/vote/abc", ownerUserId: null }, { id: "t2", name: "Gone", path: "/vote/def", ownerUserId: "deleted" }],
    arenas: () => [{ id: "a1", name: "SF bracket", path: "/arena/a1", ownerUserId: "bo" }],
    quizzes: () => [],
    getRecentAwards: () => [],
    ...overrides
  };
}

test("an unknown id has no page", () => {
  assert.equal(createWorksService(deps()).getPage("nope", null), undefined);
});

test("signed out: published readers only, no copy, counts match the rows", () => {
  const page = createWorksService(deps()).getPage("w", null)!;
  assert.equal(page.mine, null);
  assert.deepEqual(page.readers.followed, []);
  assert.deepEqual(page.readers.others.map((r) => r.username), ["bo", "cy", "viewer"]);
  assert.deepEqual(page.readers.counts, { readers: 3, finished: 2 });
  assert.equal(page.work.summary, "Especiaria.");
  assert.equal(page.work.coverUrl, "cover:e2");
});

test("signed in: own copy, followed first, never yourself, and your edition drives summary and cover", () => {
  const page = createWorksService(deps()).getPage("w", "viewer")!;
  assert.deepEqual(page.mine, { bookKey: "isbn:9780441013593", readStatus: 2, rating: 4, highlightCount: 3 });
  assert.deepEqual(page.readers.followed.map((r) => [r.username, r.published]), [["ana", false], ["cy", true]]);
  assert.deepEqual(page.readers.others.map((r) => r.username), ["bo"]);
  assert.deepEqual(page.readers.counts, { readers: 3, finished: 1 });
  assert.equal(page.readers.others[0]!.readerGlyph, "lamp");
  assert.deepEqual(page.work.editions.map((e) => e.mine), [true, false]);
  assert.deepEqual(page.work.editions.map((e) => [e.coverUrl, e.coverColor, e.pages]), [[null, null, null], ["cover:e2", "#e0a82e", null]]);
  assert.equal(page.work.summary, "Especiaria.");
  assert.equal(page.work.coverUrl, "https://c/mine.webp");
});

test("cover colour follows the cover that is shown", () => {
  const copyOfWork = (coverUrl: string | null): WorksDeps["copyOfWork"] => (userId) => (userId === "viewer" ? { bookKey: "k", readStatus: 2, rating: null, highlightCount: 0, isbn: null, coverUrl } : undefined);
  assert.equal(createWorksService(deps()).getPage("w", null)!.work.coverColor, "#e0a82e");
  assert.equal(createWorksService(deps({ copyOfWork: copyOfWork("https://c/mine.webp") })).getPage("w", "viewer")!.work.coverColor, null);
  assert.equal(createWorksService(deps({ copyOfWork: copyOfWork("cover:e2") })).getPage("w", "viewer")!.work.coverColor, "#e0a82e");
});

function pageWith(summary: string | null, editionSummaries: [string | null, string | null]): WorksDeps["getWorkPage"] {
  return () => ({
    id: "w", title: "Dune", author: "Frank Herbert", summary, aliasIds: ["w"],
    editions: [
      { bookId: "e1", title: "Dune", language: "en", year: 1965, isbn: "9780441013593", summary: editionSummaries[0], coverUrl: null, coverColor: null, genres: [], rating: null, ratingCount: 0, pages: null },
      { bookId: "e2", title: "Duna", language: "pt-BR", year: 2017, isbn: "9788576573135", summary: editionSummaries[1], coverUrl: null, coverColor: null, genres: [], rating: null, ratingCount: 0, pages: null }
    ]
  });
}

test("a summary that cleans to nothing is no summary", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith("Adicionar aos Favoritos", [null, null]) })).getPage("w", null)!;
  assert.equal(page.work.summary, null);
});

test("the work's own summary beats the first edition's", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith("Spice.", [null, "Especiaria."]) })).getPage("w", null)!;
  assert.equal(page.work.summary, "Spice.");
});

test("the viewer's edition summary beats the work's summary", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith("Spice.", ["Mine.", "Especiaria."]) })).getPage("w", "viewer")!;
  assert.equal(page.work.summary, "Mine.");
});

test("with no work summary the viewer's edition summary beats the first edition's", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith(null, ["Mine.", "Especiaria."]) })).getPage("w", "viewer")!;
  assert.equal(page.work.summary, "Mine.");
});

test("with no work summary the first edition with one is used, and with none the summary is null", () => {
  assert.equal(createWorksService(deps({ getWorkPage: pageWith(null, [null, "Especiaria."]) })).getPage("w", null)!.work.summary, "Especiaria.");
  assert.equal(createWorksService(deps({ getWorkPage: pageWith(null, [null, null]) })).getPage("w", null)!.work.summary, null);
});

test("a summary's Open Library markdown is served as plain text", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith("Sequel to *Dune*.\n\nPreceded by: [*Dune*][1]\n\n[1]: https://openlibrary.org/works/OL1W", [null, null]) })).getPage("w", null)!;
  assert.equal(page.work.summary, "Sequel to Dune.\n\nPreceded by: Dune");
});

test("reader rows carry no feeling, dates or highlights", () => {
  const page = createWorksService(deps()).getPage("w", "viewer")!;
  for (const reader of [...page.readers.followed, ...page.readers.others]) {
    assert.deepEqual(Object.keys(reader).sort(), reader.readerGlyph ? ["avatarUrl", "published", "readStatus", "readerGlyph", "username"] : ["avatarUrl", "published", "readStatus", "username"]);
  }
});

test("a merged-away id answers the canonical work", () => {
  assert.equal(createWorksService(deps()).getPage("old", null)!.work.id, "w");
});

test("games: a promoted list is the app's, an owner without a profile is dropped", () => {
  const page = createWorksService(deps()).getPage("w", null)!;
  assert.deepEqual(page.games.tierlists.map((g) => [g.id, g.owner]), [["t1", "app"]]);
  assert.deepEqual(page.games.arenas.map((g) => [g.id, g.owner]), [["a1", profile("bo")]]);
  assert.deepEqual(page.games.quizzes, []);
});

test("readers are capped at 50, followed first, while counts cover everyone visible", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ userId: `u${String(i).padStart(2, "0")}`, readStatus: 2 as const }));
  const page = createWorksService(deps({
    holdersOfWorks: () => many,
    readerVisibility: (_viewer, ids) => new Map(ids.map((id) => [id, { followed: id === "u59", published: true, showGlyph: false }])),
    resolveProfiles: (ids) => new Map(ids.map((id) => [id, profile(id)]))
  })).getPage("w", "viewer")!;
  assert.equal(page.readers.followed[0]!.username, "u59");
  assert.equal(page.readers.followed.length + page.readers.others.length, 50);
  assert.deepEqual(page.readers.counts, { readers: 60, finished: 60 });
});

type Edition = NonNullable<ReturnType<WorksDeps["getWorkPage"]>>["editions"][number];
const edition = (bookId: string, isbn: string | null, extra: Partial<Edition>): Edition => ({
  bookId, title: "Dune", language: "en", year: null, isbn, summary: null, coverUrl: null, coverColor: null, genres: [], rating: null, ratingCount: 0, pages: null, ...extra
});
const pageOf = (editions: Edition[]): WorksDeps["getWorkPage"] => () => ({ id: "w", title: "Dune", author: "Frank Herbert", summary: null, aliasIds: ["w"], editions });

test("genres only a Jev guess below the confident line carries are possible, after the others", () => {
  const getWorkPage = pageOf([edition("e1", null, { genres: ["History"] }), edition("e2", null, { genres: ["Biography & Memoir"], possible: true })]);
  const work = createWorksService(deps({ getWorkPage })).getPage("w", null)!.work;
  assert.deepEqual([work.genres, work.possibleGenres], [["History"], ["Biography & Memoir"]]);
});

test("genres: most editions first, capped at three", () => {
  const getWorkPage = pageOf([
    edition("e1", null, { genres: ["Fantasy", "Classics"] }),
    edition("e2", null, { genres: ["Classics", "Horror", "Romance"] }),
    edition("e3", null, { genres: ["Classics", "Horror"] })
  ]);
  assert.deepEqual(createWorksService(deps({ getWorkPage })).getPage("w", null)!.work.genres, ["Classics", "Horror", "Fantasy"]);
});

test("rating comes from the edition with the most ratings, ignoring invalid ones", () => {
  const getWorkPage = pageOf([
    edition("e1", null, { rating: 4.5, ratingCount: 10 }),
    edition("e2", null, { rating: 3.9, ratingCount: 300 }),
    edition("e3", null, { rating: 7, ratingCount: 900 })
  ]);
  assert.deepEqual(createWorksService(deps({ getWorkPage })).getPage("w", null)!.work.rating, { value: 3.9, count: 300 });
});

test("year is the earliest edition's; pages prefer the viewer's edition", () => {
  const getWorkPage = pageOf([
    edition("e1", "9788576573135", { year: 2017, pages: 680 }),
    edition("e2", "9780441013593", { year: 1965, pages: 412 })
  ]);
  const signedIn = createWorksService(deps({ getWorkPage })).getPage("w", "viewer")!.work;
  const signedOut = createWorksService(deps({ getWorkPage })).getPage("w", null)!.work;
  assert.equal(signedIn.year, 1965);
  assert.equal(signedIn.pages, 412);
  assert.equal(signedOut.pages, 680);
});

test("editions without details give no genres, rating, year or pages", () => {
  const work = createWorksService(deps({ getWorkPage: pageOf([edition("e1", null, {})]) })).getPage("w", null)!.work;
  assert.deepEqual([work.genres, work.rating, work.year, work.pages], [[], null, null, null]);
});

test("your own edition's summary comes before the work summary", () => {
  const work = {
    id: "w", title: "Dune", author: "Frank Herbert", summary: "Work text.", aliasIds: ["w"],
    editions: [{ bookId: "e2", title: "Duna", language: "pt-BR", year: 2017, isbn: "9788576573135", summary: "Especiaria.", coverUrl: null, coverColor: null, genres: [], rating: null, ratingCount: 0, pages: null }]
  };
  const own = { bookKey: "isbn:9788576573135", readStatus: 2 as const, rating: null, highlightCount: 0, isbn: "9788576573135", coverUrl: null };
  assert.equal(createWorksService(deps({ getWorkPage: () => work, copyOfWork: () => own })).getPage("w", "viewer")!.work.summary, "Especiaria.");
  assert.equal(createWorksService(deps({ getWorkPage: () => work })).getPage("w", null)!.work.summary, "Work text.");
});

test("a reader whose own edition has no synopsis gets one in their edition's language, never the original's English", () => {
  const english = "The story of a family and the house where they spend their summers, told over ten years.";
  const portuguese = "A história de uma família e da casa onde passam os verões, contada ao longo de dez anos.";
  const edition = (bookId: string, isbn: string, language: string, summary: string | null) => ({ bookId, title: bookId, language, year: 2000, isbn, summary, coverUrl: null, coverColor: null, genres: [], rating: null, ratingCount: 0, pages: null });
  const work = (editions: ReturnType<typeof edition>[]) => () => ({ id: "w", title: "To the Lighthouse", author: "Virginia Woolf", summary: english, aliasIds: ["w"], editions });
  const own = { bookKey: "isbn:9789720000701", readStatus: 2 as const, rating: null, highlightCount: 0, isbn: "9789720000701", coverUrl: null };
  const mine = edition("mine", "9789720000701", "pt-PT", null);
  const sibling = edition("sibling", "9789720000702", "pt-BR", portuguese);
  const original = edition("original", "9780156907391", "en", english);
  assert.equal(createWorksService(deps({ getWorkPage: work([original, mine, sibling]), copyOfWork: () => own })).getPage("w", "viewer")!.work.summary, portuguese);
  assert.equal(createWorksService(deps({ getWorkPage: work([original, mine]), copyOfWork: () => own })).getPage("w", "viewer")!.work.summary, null);
  assert.equal(createWorksService(deps({ getWorkPage: work([original, mine]) })).getPage("w", null)!.work.summary, english);
});

test("the work page carries the series as a series and each edition's collection as a collection, null when there is none", () => {
  const withSeries = (): ReturnType<WorksDeps["getWorkPage"]> => ({
    id: "w", title: "Dune", author: "Frank Herbert", summary: null, aliasIds: ["w"], series: { name: "Dune Chronicles", position: "1" },
    editions: [edition("e1", null, { collection: { name: "Bang!", position: "248" } }), edition("e2", null, {})]
  });
  const work = createWorksService(deps({ getWorkPage: withSeries })).getPage("w", null)!.work;
  assert.deepEqual(work.series, { name: "Dune Chronicles", kind: "series", position: "1" });
  assert.deepEqual(work.editions.map((e) => e.collection), [{ name: "Bang!", kind: "collection", position: "248" }, null]);
  const plain = createWorksService(deps({ getWorkPage: pageOf([edition("e1", null, {})]) })).getPage("w", null)!.work;
  assert.equal(plain.series, null);
  assert.deepEqual(plain.editions.map((e) => e.collection), [null]);
});

test("getPage passes awards through", () => {
  const awards = [{ prize: "booker", year: 2019, won: true }, { prize: "hugo-novel", year: 1966, won: false }];
  const base = deps();
  const withAwards = createWorksService({ ...base, getWorkPage: (id) => { const page = base.getWorkPage(id); return page && { ...page, awards }; } });
  assert.deepEqual(withAwards.getPage("w", null)!.work.awards, awards);
  assert.equal(createWorksService(base).getPage("w", null)!.work.awards, undefined);
});

test("recentAwards wraps the announcements", () => {
  const announcements = [{ prize: "booker", year: 2026, announcedAt: "2026-10-20T00:00:00.000Z", winners: [], nomineeWorkIds: [], honoree: null }];
  assert.deepEqual(createWorksService(deps({ getRecentAwards: () => announcements })).recentAwards(), { announcements });
});
