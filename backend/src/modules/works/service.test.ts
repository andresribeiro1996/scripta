import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorksService, type WorksDeps } from "./service.js";

const profile = (username: string) => ({ username, avatarUrl: null });

function deps(overrides: Partial<WorksDeps> = {}): WorksDeps {
  return {
    getWorkPage: (id) => (id === "old" || id === "w" ? {
      id: "w", title: "Dune", author: "Frank Herbert", summary: null, aliasIds: ["w", "old"],
      editions: [
        { bookId: "e1", title: "Dune", language: "en", year: 1965, isbn: "9780441013593", summary: null, coverUrl: null },
        { bookId: "e2", title: "Duna", language: "pt-BR", year: 2017, isbn: "9788576573135", summary: "Especiaria.", coverUrl: "cover:e2" }
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
  assert.equal(page.work.summary, "Especiaria.");
  assert.equal(page.work.coverUrl, "https://c/mine.webp");
});

function pageWith(summary: string | null, editionSummaries: [string | null, string | null]): WorksDeps["getWorkPage"] {
  return () => ({
    id: "w", title: "Dune", author: "Frank Herbert", summary, aliasIds: ["w"],
    editions: [
      { bookId: "e1", title: "Dune", language: "en", year: 1965, isbn: "9780441013593", summary: editionSummaries[0], coverUrl: null },
      { bookId: "e2", title: "Duna", language: "pt-BR", year: 2017, isbn: "9788576573135", summary: editionSummaries[1], coverUrl: null }
    ]
  });
}

test("the work's own summary beats the first edition's", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith("Spice.", [null, "Especiaria."]) })).getPage("w", null)!;
  assert.equal(page.work.summary, "Spice.");
});

test("the viewer's edition summary beats the work's", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith("Spice.", ["Mine.", "Especiaria."]) })).getPage("w", "viewer")!;
  assert.equal(page.work.summary, "Mine.");
});

test("a viewer whose edition has no summary gets the work's", () => {
  const page = createWorksService(deps({ getWorkPage: pageWith("Spice.", [null, "Especiaria."]) })).getPage("w", "viewer")!;
  assert.equal(page.work.summary, "Spice.");
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
