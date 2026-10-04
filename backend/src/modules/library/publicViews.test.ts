import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bookKey } from "@scripta/shared";

const scratch = mkdtempSync(join(tmpdir(), "library-public-views-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createSqliteLibraryRepository } = await import("./adapters/sqlite/sqliteLibraryRepository.js");
const { openLibraryDb } = await import("./adapters/sqlite/connection.js");
const { createLibraryService } = await import("./service.js");
const { resolvePublicLibrary, resolvePublicLibraryData } = await import("./publicResolver.js");
const { buildLibraryRoutes } = await import("./routes.js");
const { openBooksDb } = await import("../books/adapters/sqlite/connection.js");
const { lookupIdentity } = await import("../books/domain/normalize.js");
const { coverUrlFor } = await import("../books/publicCoverLookup.js");
const { env } = await import("../../config/env.js");

const service = createLibraryService(createSqliteLibraryRepository(openLibraryDb()), (token) => `https://scripta.test/shared/${token}`, env.LIBRARY_BODY_LIMIT_BYTES);

const year = new Date().getFullYear();
const IMAGE_ID = "0f2b6c3e-5d1a-4b7e-9c40-1a2b3c4d5e6f";
const CACHE_ISBN_ID = "11111111-1111-4111-8111-111111111111";
const CACHE_TITLE_ID = "22222222-2222-4222-8222-222222222222";
const CACHE_BEHIND_ISBN_ID = "33333333-3333-4333-8333-333333333333";
const STAMP = "2026-01-01T00:00:00.000Z";

const groupOf = (id: string, type: string, name: string, bookKeys: unknown[]) => ({ id, type, name, bookKeys, createdAt: STAMP, updatedAt: STAMP });

const books: unknown[] = [
  { ContentID: "k1", Title: "Dune (first copy)", Attribution: "F. Herbert", ISBN: "9780441013593", ReadStatus: 1, highlights: [{ BookmarkID: "c1", Text: "From the copy" }] },
  {
    ContentID: "k0",
    Title: "Dune",
    Attribution: "Frank Herbert",
    ISBN: "978-0-441-01359-3",
    ReadStatus: 2,
    DateLastRead: `${year}-03-04T10:00:00Z`,
    SeriesNumber: 1,
    _order: 3,
    _genres: ["Science Fiction"],
    Rating: 5,
    highlights: [
      { BookmarkID: "b1", Text: "First of two", Annotation: "kept" },
      { BookmarkID: "b1", Text: "Second of two", Annotation: "dropped" },
      { Text: "No id" },
      "not a highlight",
      { BookmarkID: "b2", Text: "Quoted", Annotation: "A note" },
      { BookmarkID: 7, Text: 5, Annotation: "" }
    ]
  },
  { ContentID: "k2", Attribution: "Anon Author", ReadStatus: 0 },
  { ContentID: "k3", Title: "Orphan Title", ReadStatus: 2, DateLastRead: `${year - 1}-06-15T12:00:00Z`, _genres: ["Fantasy"] },
  { ContentID: "k4", Title: 42, Attribution: "Numeric Author", ISBN: 9780141439587, ImageId: 5, ReadStatus: "2", _order: "7", SeriesNumber: "2" },
  null,
  7,
  ["array entry"],
  { ContentID: "k8", Title: "Manual Cover", Attribution: "Cover Author", ISBN: "9781111111111", ImageId: IMAGE_ID, ReadStatus: 1, _coverUrl: "https://covers.test/manual.jpg", highlights: [{ BookmarkID: "m1", Text: "Manual quote" }] },
  { ContentID: "k9", Title: "Empty Cover", Attribution: "Cover Author", ISBN: "9782222222222", ReadStatus: 0, _coverUrl: "" },
  { ContentID: "k10", Title: "Cached By Isbn", Attribution: "Cache Author", ISBN: "9783333333333", ReadStatus: 0 },
  { ContentID: "k11", Title: "Cached By Title", Attribution: "Cache Author", ReadStatus: 0 },
  { ContentID: "k12", Title: "Isbn Without Cover", Attribution: "Cache Author", ISBN: "9784444444444", ReadStatus: 1 },
  { ContentID: "k13", Title: "Bad Date", Attribution: "Date Author", ReadStatus: 2, DateLastRead: "not a date" },
  { ContentID: "k14", Title: "Numeric Date", Attribution: "Date Author", ReadStatus: 2, DateLastRead: 12345 },
  { ContentID: "k15", Title: "Finished This Year", Attribution: "Date Author", ReadStatus: 2, DateLastRead: `${year}-01-02T12:00:00Z`, _order: 2 ** 60 },
  { ContentID: "k16", Title: "Emma", Attribution: "Jane Austen", ISBN: "9780141439587X", ReadStatus: 1, _coverUrl: 5, SeriesNumber: 2, _genres: ["Romance", "Fantasy"] }
];

const dune = bookKey(books[1] as Record<string, unknown>);
const emma = bookKey(books[16] as Record<string, unknown>);
const numeric = bookKey(books[4] as Record<string, unknown>);
const manual = bookKey(books[8] as Record<string, unknown>);
const noTitle = bookKey(books[2] as Record<string, unknown>);

const groups: unknown[] = [
  groupOf("saga", "series", "Dune saga", [dune, emma]),
  groupOf("col1", "collection", "Favourites", [emma, "ta:ghost|nobody", 5, dune, manual]),
  groupOf("col2", "collection", "Empty", []),
  "not a group",
  { id: "broken", type: "collection" }
];

const mainDocument = { source: "kobo", schema_version: 3, book_count: 99, name: "Public Reader", style: { theme: "ink" }, groups, books };

const cacheDb = openBooksDb();
function cacheCover(id: string, imageId: string, keys: string[], isbn: string | null) {
  cacheDb.prepare(`INSERT INTO books (id, title, author, isbn, cover_image_id, cover_status, created_at) VALUES (?, '', '', ?, ?, ?, ?)`).run(id, isbn, imageId, imageId ? "good" : null, STAMP);
  for (const key of keys) cacheDb.prepare(`INSERT INTO book_keys (key, book_id) VALUES (?, ?)`).run(key, id);
}
const titleKeyOf = (title: string, author: string) => lookupIdentity({ title, author })!.titleKey!;
cacheCover("cache-isbn", CACHE_ISBN_ID, ["isbn:9783333333333"], "9783333333333");
cacheCover("cache-title", CACHE_TITLE_ID, [titleKeyOf("Cached By Title", "Cache Author")], null);
cacheCover("cache-isbn-empty", "", ["isbn:9784444444444"], "9784444444444");
cacheCover("cache-behind-isbn", CACHE_BEHIND_ISBN_ID, [titleKeyOf("Isbn Without Cover", "Cache Author")], null);

const users = { main: "pv-main", empty: "pv-empty", bare: "pv-bare" };
const saved = {
  main: service.saveLibrary(users.main, mainDocument),
  empty: service.saveLibrary(users.empty, { books: [], name: "Nothing yet" }),
  bare: service.saveLibrary(users.bare, { books: [{ Title: "Only Title" }, { Attribution: "Only Author" }, {}] })
};
const tokens = { main: service.share(users.main).shareToken!, empty: service.share(users.empty).shareToken!, bare: service.share(users.bare).shareToken! };

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const fullRequest = {
  collectionIds: ["col1", "col2", "saga", "missing"],
  bookKeys: [emma, "ta:ghost|nobody", dune, noTitle, manual, numeric, emma, "isbn:9783333333333", "ta:cached by title|cache author", "isbn:9784444444444", "isbn:9782222222222", "ta:|", "ta:bad date|date author"],
  highlightRefs: [
    { bookKey: dune, highlightId: "b2" },
    { bookKey: dune, highlightId: "b1" },
    { bookKey: dune, highlightId: "b2" },
    { bookKey: dune, highlightId: "undefined" },
    { bookKey: dune, highlightId: "7" },
    { bookKey: dune, highlightId: "nope" },
    { bookKey: manual, highlightId: "m1" },
    { bookKey: "ta:ghost|nobody", highlightId: "b1" }
  ],
  needsCurrentlyReading: true,
  statsMetrics: ["totalBooks", "booksFinished", "booksFinishedThisYear", "booksInProgress", "totalHighlights", "unknownMetric"],
  needsShelfTheme: true,
  needsReaderCard: true
};
const bareRequest = { bookKeys: [], highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] };

const expectedSharedMain = {
  data: {
    source: "kobo",
    schema_version: 3,
    book_count: 99,
    name: "Public Reader",
    groups: [
      {
        id: "saga",
        type: "series",
        name: "Dune saga",
        bookKeys: [
          "isbn:9780441013593",
          "ta:emma|jane austen"
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "col1",
        type: "collection",
        name: "Favourites",
        bookKeys: [
          "ta:emma|jane austen",
          "ta:ghost|nobody",
          5,
          "isbn:9780441013593",
          "isbn:9781111111111"
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "col2",
        type: "collection",
        name: "Empty",
        bookKeys: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      "not a group",
      {
        id: "broken",
        type: "collection"
      }
    ],
    style: {
      theme: "ink"
    },
    books: [
      {
        Title: "Dune (first copy)",
        Attribution: "F. Herbert",
        ISBN: "9780441013593",
        ReadStatus: 1,
        _coverUrl: null
      },
      {
        Title: "Dune",
        Attribution: "Frank Herbert",
        ISBN: "978-0-441-01359-3",
        ReadStatus: 2,
        SeriesNumber: 1,
        _order: 3,
        _coverUrl: null
      },
      {
        Attribution: "Anon Author",
        ReadStatus: 0,
        _coverUrl: null
      },
      {
        Title: "Orphan Title",
        ReadStatus: 2,
        _coverUrl: null
      },
      {
        Attribution: "Numeric Author",
        _coverUrl: null
      },
      {
        _coverUrl: null
      },
      {
        Title: "Manual Cover",
        Attribution: "Cover Author",
        ISBN: "9781111111111",
        ImageId: "0f2b6c3e-5d1a-4b7e-9c40-1a2b3c4d5e6f",
        ReadStatus: 1,
        _coverUrl: "https://covers.test/manual.jpg"
      },
      {
        Title: "Empty Cover",
        Attribution: "Cover Author",
        ISBN: "9782222222222",
        ReadStatus: 0,
        _coverUrl: ""
      },
      {
        Title: "Cached By Isbn",
        Attribution: "Cache Author",
        ISBN: "9783333333333",
        ReadStatus: 0,
        _coverUrl: coverUrlFor(CACHE_ISBN_ID, "thumb")
      },
      {
        Title: "Cached By Title",
        Attribution: "Cache Author",
        ReadStatus: 0,
        _coverUrl: coverUrlFor(CACHE_TITLE_ID, "thumb")
      },
      {
        Title: "Isbn Without Cover",
        Attribution: "Cache Author",
        ISBN: "9784444444444",
        ReadStatus: 1,
        _coverUrl: null
      },
      {
        Title: "Bad Date",
        Attribution: "Date Author",
        ReadStatus: 2,
        _coverUrl: null
      },
      {
        Title: "Numeric Date",
        Attribution: "Date Author",
        ReadStatus: 2,
        _coverUrl: null
      },
      {
        Title: "Finished This Year",
        Attribution: "Date Author",
        ReadStatus: 2,
        _order: 1152921504606847000,
        _coverUrl: null
      },
      {
        Title: "Emma",
        Attribution: "Jane Austen",
        ISBN: "9780141439587X",
        ReadStatus: 1,
        SeriesNumber: 2,
        _coverUrl: null
      }
    ]
  }
};

const expectedSharedEmpty = {
  data: {
    name: "Nothing yet",
    books: []
  }
};

const expectedSharedBare = {
  data: {
    books: [
      {
        Title: "Only Title",
        _coverUrl: null
      },
      {
        Attribution: "Only Author",
        _coverUrl: null
      },
      {
        _coverUrl: null
      }
    ]
  }
};

const expectedProfileMain = {
  source: "kobo",
  schema_version: 3,
  book_count: 99,
  name: "Public Reader",
  groups: [
    {
      id: "saga",
      type: "series",
      name: "Dune saga",
      bookKeys: [
        "isbn:9780441013593",
        "ta:emma|jane austen"
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "col1",
      type: "collection",
      name: "Favourites",
      bookKeys: [
        "ta:emma|jane austen",
        "ta:ghost|nobody",
        5,
        "isbn:9780441013593",
        "isbn:9781111111111"
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "col2",
      type: "collection",
      name: "Empty",
      bookKeys: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    "not a group",
    {
      id: "broken",
      type: "collection"
    }
  ],
  style: {
    theme: "ink"
  },
  books: [
    {
      Title: "Dune (first copy)",
      Attribution: "F. Herbert",
      ISBN: "9780441013593",
      ReadStatus: 1,
      _coverUrl: null
    },
    {
      Title: "Dune",
      Attribution: "Frank Herbert",
      ISBN: "978-0-441-01359-3",
      ReadStatus: 2,
      SeriesNumber: 1,
      _order: 3,
      _coverUrl: null
    },
    {
      Attribution: "Anon Author",
      ReadStatus: 0,
      _coverUrl: null
    },
    {
      Title: "Orphan Title",
      ReadStatus: 2,
      _coverUrl: null
    },
    {
      Attribution: "Numeric Author",
      _coverUrl: null
    },
    {
      _coverUrl: null
    },
    {
      Title: "Manual Cover",
      Attribution: "Cover Author",
      ISBN: "9781111111111",
      ImageId: "0f2b6c3e-5d1a-4b7e-9c40-1a2b3c4d5e6f",
      ReadStatus: 1,
      _coverUrl: "https://covers.test/manual.jpg"
    },
    {
      Title: "Empty Cover",
      Attribution: "Cover Author",
      ISBN: "9782222222222",
      ReadStatus: 0,
      _coverUrl: ""
    },
    {
      Title: "Cached By Isbn",
      Attribution: "Cache Author",
      ISBN: "9783333333333",
      ReadStatus: 0,
      _coverUrl: coverUrlFor(CACHE_ISBN_ID, "thumb")
    },
    {
      Title: "Cached By Title",
      Attribution: "Cache Author",
      ReadStatus: 0,
      _coverUrl: coverUrlFor(CACHE_TITLE_ID, "thumb")
    },
    {
      Title: "Isbn Without Cover",
      Attribution: "Cache Author",
      ISBN: "9784444444444",
      ReadStatus: 1,
      _coverUrl: null
    },
    {
      Title: "Bad Date",
      Attribution: "Date Author",
      ReadStatus: 2,
      _coverUrl: null
    },
    {
      Title: "Numeric Date",
      Attribution: "Date Author",
      ReadStatus: 2,
      _coverUrl: null
    },
    {
      Title: "Finished This Year",
      Attribution: "Date Author",
      ReadStatus: 2,
      _order: 1152921504606847000,
      _coverUrl: null
    },
    {
      Title: "Emma",
      Attribution: "Jane Austen",
      ISBN: "9780141439587X",
      ReadStatus: 1,
      SeriesNumber: 2,
      _coverUrl: null
    }
  ]
};

const expectedProfileEmpty = {
  name: "Nothing yet",
  books: []
};

const expectedProfileBare = {
  books: [
    {
      Title: "Only Title",
      _coverUrl: null
    },
    {
      Attribution: "Only Author",
      _coverUrl: null
    },
    {
      _coverUrl: null
    }
  ]
};

const expectedDataMain = {
  books: [
    {
      title: "Emma",
      author: "Jane Austen",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: 1
    },
    {
      title: "Dune",
      author: "Frank Herbert",
      isbn: "9780441013593",
      imageId: null,
      coverUrl: null,
      readStatus: 2
    },
    {
      title: "Untitled",
      author: "Anon Author",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: 0
    },
    {
      title: "Manual Cover",
      author: "Cover Author",
      isbn: "9781111111111",
      imageId: "0f2b6c3e-5d1a-4b7e-9c40-1a2b3c4d5e6f",
      coverUrl: "https://covers.test/manual.jpg",
      readStatus: 1
    },
    {
      title: "Untitled",
      author: "Numeric Author",
      isbn: "9780141439587",
      imageId: null,
      coverUrl: null,
      readStatus: null
    },
    {
      title: "Cached By Isbn",
      author: "Cache Author",
      isbn: "9783333333333",
      imageId: null,
      coverUrl: coverUrlFor(CACHE_ISBN_ID, "thumb"),
      readStatus: 0
    },
    {
      title: "Cached By Title",
      author: "Cache Author",
      isbn: null,
      imageId: null,
      coverUrl: coverUrlFor(CACHE_TITLE_ID, "thumb"),
      readStatus: 0
    },
    {
      title: "Isbn Without Cover",
      author: "Cache Author",
      isbn: "9784444444444",
      imageId: null,
      coverUrl: null,
      readStatus: 1
    },
    {
      title: "Empty Cover",
      author: "Cover Author",
      isbn: "9782222222222",
      imageId: null,
      coverUrl: "",
      readStatus: 0
    },
    {
      title: "Untitled",
      author: "Unknown author",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: null
    },
    {
      title: "Bad Date",
      author: "Date Author",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: 2
    }
  ],
  highlights: [
    {
      bookKey: "isbn:9780441013593",
      highlightId: "b2",
      text: "Quoted",
      annotation: "A note"
    },
    {
      bookKey: "isbn:9780441013593",
      highlightId: "b1",
      text: "First of two",
      annotation: "kept"
    },
    {
      bookKey: "isbn:9780441013593",
      highlightId: "b2",
      text: "Quoted",
      annotation: "A note"
    },
    {
      bookKey: "isbn:9780441013593",
      highlightId: "undefined",
      text: "No id",
      annotation: null
    },
    {
      bookKey: "isbn:9780441013593",
      highlightId: "7",
      text: "",
      annotation: null
    },
    {
      bookKey: "isbn:9781111111111",
      highlightId: "m1",
      text: "Manual quote",
      annotation: null
    }
  ],
  currentlyReading: [
    {
      title: "Dune (first copy)",
      author: "F. Herbert",
      isbn: "9780441013593",
      imageId: null,
      coverUrl: null,
      readStatus: 1
    },
    {
      title: "Manual Cover",
      author: "Cover Author",
      isbn: "9781111111111",
      imageId: "0f2b6c3e-5d1a-4b7e-9c40-1a2b3c4d5e6f",
      coverUrl: "https://covers.test/manual.jpg",
      readStatus: 1
    },
    {
      title: "Isbn Without Cover",
      author: "Cache Author",
      isbn: "9784444444444",
      imageId: null,
      coverUrl: null,
      readStatus: 1
    },
    {
      title: "Emma",
      author: "Jane Austen",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: 1
    }
  ],
  stats: {
    totalBooks: 15,
    booksFinished: 5,
    booksFinishedThisYear: 2,
    booksInProgress: 4,
    totalHighlights: 8
  },
  shelfTheme: {
    genres: [
      "Fantasy",
      "Science Fiction",
      "Romance"
    ],
    matchedBooks: 3,
    totalBooks: 15
  },
  readerCard: {
    state: "settled",
    identity: "loyal",
    runnerUp: null,
    signal: {
      counted: 3,
      of: 5,
      label: "3 of 5 finished books are by authors you keep returning to"
    },
    coverage: [
      "genres known for 2 of 5 finished books"
    ]
  },
  collectionBooks: {
    col1: [
      "ta:emma|jane austen",
      "isbn:9780441013593",
      "isbn:9781111111111"
    ],
    col2: [],
    saga: [],
    missing: []
  }
};

const expectedDataMainBare = {
  books: [],
  highlights: [],
  currentlyReading: [],
  stats: {}
};

const expectedDataEmpty = {
  books: [],
  highlights: [],
  currentlyReading: [],
  stats: {
    totalBooks: 0,
    booksFinished: 0,
    booksFinishedThisYear: 0,
    booksInProgress: 0,
    totalHighlights: 0
  },
  shelfTheme: {
    genres: [],
    matchedBooks: 0,
    totalBooks: 0
  },
  readerCard: {
    state: "unwritten",
    identity: null,
    runnerUp: null,
    signal: null,
    coverage: [
      "genres known for 0 of 0 finished books"
    ]
  },
  collectionBooks: {
    col1: []
  }
};

const expectedDataBare = {
  books: [
    {
      title: "Only Title",
      author: "Unknown author",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: null
    },
    {
      title: "Untitled",
      author: "Only Author",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: null
    },
    {
      title: "Untitled",
      author: "Unknown author",
      isbn: null,
      imageId: null,
      coverUrl: null,
      readStatus: null
    }
  ],
  highlights: [],
  currentlyReading: [],
  stats: {
    totalBooks: 3,
    booksFinished: 0,
    booksFinishedThisYear: 0,
    booksInProgress: 0,
    totalHighlights: 0
  },
  shelfTheme: {
    genres: [],
    matchedBooks: 0,
    totalBooks: 3
  },
  readerCard: {
    state: "unwritten",
    identity: null,
    runnerUp: null,
    signal: null,
    coverage: [
      "genres known for 0 of 0 finished books"
    ]
  },
  collectionBooks: {
    col1: [],
    col2: [],
    saga: [],
    missing: []
  }
};

const expectedDataGhost = {
  books: [],
  highlights: [],
  currentlyReading: [],
  stats: {},
  readerCard: {
    state: "unwritten",
    identity: null,
    runnerUp: null,
    signal: null,
    coverage: [
      "genres known for 0 of 0 finished books"
    ]
  }
};

test("the shared library view", () => {
  assert.deepEqual(json(service.getPublicByToken(tokens.main)), expectedSharedMain);
  assert.deepEqual(json(service.getPublicByToken(tokens.empty)), expectedSharedEmpty);
  assert.deepEqual(json(service.getPublicByToken(tokens.bare)), expectedSharedBare);
});

test("the shared library view is null for an unknown or unshared token", () => {
  assert.equal(service.getPublicByToken("no-such-token"), null);
  service.saveLibrary("pv-unshared", { books: [{ Title: "Hidden" }] });
  const token = service.share("pv-unshared").shareToken!;
  service.unshare("pv-unshared");
  assert.equal(service.getPublicByToken(token), null);
});

test("the profile library view", () => {
  assert.deepEqual(json(resolvePublicLibrary(users.main)), expectedProfileMain);
  assert.deepEqual(json(resolvePublicLibrary(users.empty)), expectedProfileEmpty);
  assert.deepEqual(json(resolvePublicLibrary(users.bare)), expectedProfileBare);
  assert.equal(resolvePublicLibrary("pv-ghost"), null);
});

test("the mural data view with every kind of reference", () => {
  assert.deepEqual(json(resolvePublicLibraryData(users.main, fullRequest)), expectedDataMain);
});

test("the mural data view without requests", () => {
  assert.deepEqual(json(resolvePublicLibraryData(users.main, bareRequest)), expectedDataMainBare);
});

test("the mural data view of an empty library, a sparse one and a missing one", () => {
  assert.deepEqual(json(resolvePublicLibraryData(users.empty, { ...fullRequest, collectionIds: ["col1"] })), expectedDataEmpty);
  assert.deepEqual(json(resolvePublicLibraryData(users.bare, { ...fullRequest, bookKeys: ["ta:only title|", "ta:|only author", "ta:|"] })), expectedDataBare);
  assert.deepEqual(json(resolvePublicLibraryData("pv-ghost", fullRequest)), expectedDataGhost);
});

test("the mural data view fails loudly when the reader card or shelf theme is missing", () => {
  service.saveLibrary("pv-no-card", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] });
  const db = openLibraryDb();
  const base = { bookKeys: [], highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] };
  db.prepare("UPDATE library_summary SET reader_card = NULL WHERE user_id = ?").run("pv-no-card");
  assert.throws(() => resolvePublicLibraryData("pv-no-card", { ...base, needsReaderCard: true }), /Reader card of pv-no-card is unavailable/);
  assert.doesNotThrow(() => resolvePublicLibraryData("pv-no-card", base));
  db.prepare("UPDATE library_summary SET shelf_theme = NULL WHERE user_id = ?").run("pv-no-card");
  assert.throws(() => resolvePublicLibraryData("pv-no-card", { ...base, needsShelfTheme: true }), /Shelf theme of pv-no-card is unavailable/);
});

async function ownerApp() {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildLibraryRoutes(service));
  await app.ready();
  return app;
}

test("GET /library sends the stored document as UTF-8 JSON", async () => {
  const app = await ownerApp();
  const stored = service.getLibrary(users.main)!;
  const res = await app.inject({ method: "GET", url: "/library", headers: { authorization: `Bearer ${users.main}` } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.body, JSON.stringify({ data: stored.data, updatedAt: saved.main.updatedAt, shareToken: tokens.main, shareUrl: `https://scripta.test/shared/${tokens.main}` }));
  assert.deepEqual(JSON.parse(res.body).data, json(mainDocument));
  await app.close();
});

test("GET /library sends null share fields for an unshared library", async () => {
  const app = await ownerApp();
  service.saveLibrary("pv-private", { books: [{ Title: "Mine" }] });
  const stored = service.getLibrary("pv-private")!;
  const res = await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer pv-private" } });
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.body, JSON.stringify({ data: { books: [{ Title: "Mine" }] }, updatedAt: stored.updatedAt, shareToken: null, shareUrl: null }));
  await app.close();
});

test("PUT /library answers a stale updatedAt with 409 and the current document", async () => {
  const app = await ownerApp();
  const stored = service.getLibrary(users.empty)!;
  const res = await app.inject({
    method: "PUT",
    url: "/library",
    headers: { authorization: `Bearer ${users.empty}` },
    payload: { data: { books: [{ Title: "Lost" }] }, updatedAt: "2000-01-01T00:00:00.000Z" }
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.body, JSON.stringify({ error: "The library changed elsewhere since it was loaded.", current: stored }));
  assert.deepEqual(service.getLibrary(users.empty)!.data, { books: [], name: "Nothing yet" });
  await app.close();
});
