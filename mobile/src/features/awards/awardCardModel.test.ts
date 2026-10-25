import assert from "node:assert/strict";
import { test } from "node:test";
import type { AwardAnnouncement, AwardWinner, LibraryDocument } from "@scripta/shared";
import { awardCardModel, firstUndismissed } from "./awardCardModel.js";

const winner = (workId: string, title = "Wolf Hall", author = "Hilary Mantel"): AwardWinner => ({ workId, title, author, coverUrl: `https://covers.test/${workId}.jpg` });
const bookPrize = (overrides: Partial<AwardAnnouncement> = {}): AwardAnnouncement => ({ prize: "booker", year: 2026, announcedAt: "2026-10-20T00:00:00.000Z", winners: [winner("w1")], nomineeWorkIds: [], honoree: null, ...overrides });
const authorPrize = (overrides: Partial<AwardAnnouncement> = {}): AwardAnnouncement => ({ prize: "nobel-literature", year: 2022, announcedAt: "2026-10-20T00:00:00.000Z", winners: [], nomineeWorkIds: [], honoree: { name: "Annie Ernaux", workIds: ["w1", "w2", "w3"] }, ...overrides });
const library = (held: Record<string, number | undefined>, extra: Array<Record<string, unknown>> = []): LibraryDocument => ({
  data: { books: [...Object.entries(held).map(([workId, ReadStatus]) => ({ _key: `key-${workId}`, Title: workId, ReadStatus })), ...extra] },
  updatedAt: "2026-10-20T00:00:00.000Z",
  shareToken: null,
  shareUrl: null,
  works: Object.fromEntries(Object.keys(held).map((workId) => [`key-${workId}`, workId])),
});

test("a book prize card names the prize and year and the winner's title and author", () => {
  assert.deepEqual(awardCardModel(bookPrize(), null), {
    key: "awardDismissed:booker:2026",
    title: "Booker Prize 2026",
    subtitle: "Wolf Hall · Hilary Mantel",
    shelfLine: null,
    coverUrl: "https://covers.test/w1.jpg",
    target: { kind: "work", id: "w1" },
  });
});

test("joint winners read 'and 1 more' and target the first winner", () => {
  const joint = bookPrize({ prize: "international-booker", year: 2019, winners: [winner("w9", "Celestial Bodies", "Jokha Alharthi"), winner("w8", "Girl, Woman, Other", "Bernardine Evaristo")] });
  const model = awardCardModel(joint, null);
  assert.equal(model?.subtitle, "Celestial Bodies · Jokha Alharthi and 1 more");
  assert.deepEqual(model?.target, { kind: "work", id: "w9" });
  assert.equal(awardCardModel({ ...joint, winners: [...joint.winners, winner("w7")] }, null)?.subtitle, "Celestial Bodies · Jokha Alharthi and 2 more");
});

test("the shelf line says read, reading or to-read for a held winner", () => {
  assert.equal(awardCardModel(bookPrize(), library({ w1: 2 }))?.shelfLine, "You've read it");
  assert.equal(awardCardModel(bookPrize(), library({ w1: 1 }))?.shelfLine, "You're reading it");
  assert.equal(awardCardModel(bookPrize(), library({ w1: 0 }))?.shelfLine, "On your to-read shelf");
  assert.equal(awardCardModel(bookPrize(), library({ w1: undefined }))?.shelfLine, "On your to-read shelf");
  assert.equal(awardCardModel(bookPrize({ nomineeWorkIds: ["w2"] }), library({ w1: 2, w2: 2 }))?.shelfLine, "You've read it");
});

test("a work held in two editions reads at its furthest status", () => {
  const twoCopies = library({ w1: 0 }, [{ _key: "second-copy", ReadStatus: 2 }]);
  twoCopies.works = { ...twoCopies.works, "second-copy": "w1" };
  assert.equal(awardCardModel(bookPrize(), twoCopies)?.shelfLine, "You've read it");
  twoCopies.data.books.reverse();
  assert.equal(awardCardModel(bookPrize(), twoCopies)?.shelfLine, "You've read it");
});

test("the shelf line counts held nominees when the winner isn't held, with singular and plural", () => {
  const nominated = bookPrize({ nomineeWorkIds: ["w2", "w3", "w4"] });
  assert.equal(awardCardModel(nominated, library({ w2: 0 }))?.shelfLine, "1 nominee in your library");
  assert.equal(awardCardModel(nominated, library({ w2: 2, w4: 1 }))?.shelfLine, "2 nominees in your library");
  assert.equal(awardCardModel(nominated, library({ w9: 2 }))?.shelfLine, null);
});

test("an author prize card names the honoree, counts their held books and targets Search", () => {
  const model = awardCardModel(authorPrize(), library({ w1: 2, w3: 0, w9: 2 }));
  assert.deepEqual(model, {
    key: "awardDismissed:nobel-literature:2022",
    title: "Nobel Prize in Literature 2022",
    subtitle: "Annie Ernaux",
    shelfLine: "2 of their books in your library",
    coverUrl: null,
    target: { kind: "search", query: "Annie Ernaux" },
  });
  assert.equal(awardCardModel(authorPrize(), library({ w2: 1 }))?.shelfLine, "1 of their books in your library");
  assert.equal(awardCardModel(authorPrize(), library({ w9: 1 }))?.shelfLine, null);
});

test("no library gives no shelf line", () => {
  assert.equal(awardCardModel(bookPrize({ nomineeWorkIds: ["w2"] }), null)?.shelfLine, null);
  assert.equal(awardCardModel(authorPrize(), null)?.shelfLine, null);
});

test("a book whose work isn't resolved isn't counted", () => {
  const unresolved = library({}, [{ _key: "key-w1", ReadStatus: 2 }, { _key: "key-w2", ReadStatus: 2 }]);
  assert.equal(awardCardModel(bookPrize({ nomineeWorkIds: ["w2"] }), unresolved)?.shelfLine, null);
  assert.equal(awardCardModel(authorPrize(), unresolved)?.shelfLine, null);
  const withoutWorks = { ...unresolved, works: undefined };
  assert.equal(awardCardModel(bookPrize(), withoutWorks)?.shelfLine, null);
});

test("an unknown prize gives null", () => {
  assert.equal(awardCardModel(bookPrize({ prize: "goodreads-choice" }), null), null);
  assert.equal(awardCardModel(bookPrize({ prize: "toString" }), null), null);
});

test("firstUndismissed skips dismissed keys and unknown prizes", () => {
  const unknown = bookPrize({ prize: "goodreads-choice" });
  const hugo = bookPrize({ prize: "hugo-novel", year: 2026 });
  const booker = bookPrize();
  const nobel = authorPrize();
  assert.equal(firstUndismissed([unknown, hugo, booker, nobel], new Set()), hugo);
  assert.equal(firstUndismissed([unknown, hugo, booker, nobel], new Set(["awardDismissed:hugo-novel:2026"])), booker);
  assert.equal(firstUndismissed([unknown, hugo, booker, nobel], new Set(["awardDismissed:hugo-novel:2026", "awardDismissed:booker:2026"])), nobel);
  assert.equal(firstUndismissed([unknown, hugo], new Set(["awardDismissed:hugo-novel:2026"])), undefined);
  assert.equal(firstUndismissed([], new Set()), undefined);
});
