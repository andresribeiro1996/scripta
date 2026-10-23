import assert from "node:assert/strict";
import { test } from "node:test";
import { planDuplicateSets, planTitleFolds } from "./duplicateWorks.js";
import { workTitleKey } from "./normalize.js";

const KEY = workTitleKey("Fourth Wing", "Rebecca Yarros");
const noSeries = () => false;
const plan = (sets: ReturnType<typeof planDuplicateSets>["sets"]) => ({ sets, seriesName: 0, crowded: 0 });

test("merges keyed works with the same full title into the one with the most editions", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 2, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-b", title: "Fourth WIng", author: "Rebecca Yarros", editions: 9, absorbed: 0, createdAt: "2026-09-02" }
  ], noSeries), plan([{ titleKey: KEY, into: "w-b", from: ["w-a"] }]));
});

test("keeps a graphic novel apart from the novel it shares a title key with", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-novel", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-gn", title: "Fourth Wing: The Graphic Novel", author: "Rebecca Yarros", editions: 1, absorbed: 0, createdAt: "2026-09-02" }
  ], noSeries), plan([]));
});

test("breaks an editions tie by the oldest work, then the lowest id", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, absorbed: 0, createdAt: "2026-09-05" },
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, absorbed: 0, createdAt: "2026-09-01" }
  ], noSeries), plan([{ titleKey: KEY, into: "w-b", from: ["w-a"] }]));
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, absorbed: 0, createdAt: "2026-09-01" }
  ], noSeries), plan([{ titleKey: KEY, into: "w-a", from: ["w-b"] }]));
});

test("leaves out a work whose own title key differs from the shared edition key", () => {
  const works = [
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 2, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 1, absorbed: 0, createdAt: "2026-09-02" },
    { titleKey: KEY, id: "w-x", title: "Iron Flame", author: "Rebecca Yarros", editions: 9, absorbed: 0, createdAt: "2026-08-01" },
    { titleKey: KEY, id: "w-y", title: "Iron Flame", author: "Rebecca Yarros", editions: 8, absorbed: 0, createdAt: "2026-08-02" }
  ];
  assert.deepEqual(planDuplicateSets(works, noSeries), plan([{ titleKey: KEY, into: "w-a", from: ["w-b"] }]));
});

test("never merges works with an empty or placeholder first author", () => {
  for (const author of ["Anónimo", "AA.VV.", "AAVV", "Diversos", ""]) {
    const titleKey = workTitleKey("Cantar de Mio Cid", author);
    assert.deepEqual(planDuplicateSets([
      { titleKey, id: "w-a", title: "Cantar de Mio Cid", author, editions: 2, absorbed: 0, createdAt: "2026-09-01" },
      { titleKey, id: "w-b", title: "Cantar de Mio Cid", author, editions: 1, absorbed: 0, createdAt: "2026-09-02" }
    ], noSeries), plan([]), author);
  }
});

test("counts a work listed twice once", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 1, absorbed: 0, createdAt: "2026-09-02" }
  ], noSeries), plan([{ titleKey: KEY, into: "w-a", from: ["w-b"] }]));
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, absorbed: 0, createdAt: "2026-09-01" }
  ], noSeries), plan([]));
});

test("never merges works whose title key is empty", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: "", id: "w-a", title: "!!!", author: "Jane Doe", editions: 2, absorbed: 0, createdAt: "2026-09-01" },
    { titleKey: "", id: "w-b", title: "???", author: "John Roe", editions: 1, absorbed: 0, createdAt: "2026-09-02" }
  ], noSeries), plan([]));
});

const NATE = workTitleKey("Big Nate", "Lincoln Peirce");
const nate = (id: string) => ({ titleKey: NATE, id, title: "Big Nate", author: "Lincoln Peirce", editions: 1, absorbed: 0, createdAt: "2026-09-01" });

test("skips a set whose full title is a series name, and asks only about sets of two or more", () => {
  const asked: string[] = [];
  const isSeriesName = (fullTitle: string) => {
    asked.push(fullTitle);
    return fullTitle === "big nate";
  };

  assert.deepEqual(planDuplicateSets([nate("w-a"), nate("w-b")], isSeriesName), { sets: [], seriesName: 1, crowded: 0 });
  assert.deepEqual(asked, ["big nate"]);

  asked.length = 0;
  assert.deepEqual(planDuplicateSets([nate("w-a")], isSeriesName), plan([]));
  assert.deepEqual(asked, []);
});

test("skips a set of three or more works as crowded, counting the works left unmerged", () => {
  assert.deepEqual(
    planDuplicateSets([nate("w-a"), nate("w-b"), nate("w-c")], noSeries),
    { sets: [], seriesName: 0, crowded: 2 }
  );
  assert.deepEqual(
    planDuplicateSets([nate("w-a"), nate("w-b"), nate("w-c"), nate("w-d")], noSeries),
    { sets: [], seriesName: 0, crowded: 3 }
  );
});

test("skips a pair as crowded when either work has already absorbed a duplicate", () => {
  const pair = (survivorAbsorbed: number, otherAbsorbed: number) => [
    { titleKey: NATE, id: "w-a", title: "Big Nate", author: "Lincoln Peirce", editions: 9, absorbed: survivorAbsorbed, createdAt: "2026-09-01" },
    { titleKey: NATE, id: "w-b", title: "Big Nate", author: "Lincoln Peirce", editions: 1, absorbed: otherAbsorbed, createdAt: "2026-09-02" }
  ];
  assert.deepEqual(planDuplicateSets(pair(1, 0), noSeries), { sets: [], seriesName: 0, crowded: 1 });
  assert.deepEqual(planDuplicateSets(pair(0, 1), noSeries), { sets: [], seriesName: 0, crowded: 1 });
  assert.deepEqual(planDuplicateSets(pair(0, 0), noSeries), plan([{ titleKey: NATE, into: "w-a", from: ["w-b"] }]));
});

test("a crowded set whose title is a series name counts once, as the series name", () => {
  assert.deepEqual(
    planDuplicateSets([nate("w-a"), nate("w-b"), nate("w-c")], () => true),
    { sets: [], seriesName: 2, crowded: 0 }
  );
});

test("skipping one set leaves the pairs around it planned", () => {
  const wing = (id: string) => ({ titleKey: KEY, id, title: "Fourth Wing", author: "Rebecca Yarros", editions: 1, absorbed: 0, createdAt: "2026-09-01" });
  assert.deepEqual(
    planDuplicateSets([nate("n-a"), nate("n-b"), wing("w-b"), wing("w-a"), nate("n-c")], (fullTitle) => fullTitle === "big nate"),
    { sets: [{ titleKey: KEY, into: "w-a", from: ["w-b"] }], seriesName: 2, crowded: 0 }
  );
});

const titled = (titleKey: string, workId: string, title: string, keyed: boolean, createdAt: string) => ({ titleKey, workId, title, keyed, createdAt });
const LUPIN = workTitleKey("Arsène Lupin", "Maurice Leblanc");

test("planTitleFolds folds a keyless work into the one keyed work with its full title", () => {
  assert.deepEqual(planTitleFolds([
    titled(KEY, "w-novel", "Fourth Wing", true, "2026-09-01"),
    titled(KEY, "w-gn", "Fourth Wing: The Graphic Novel", true, "2026-09-02"),
    titled(KEY, "k-1", "Fourth wing", false, "2026-09-03"),
    titled(KEY, "k-2", "Fourth Wing: The Graphic Novel", false, "2026-09-04")
  ]), [
    { source: "k-1", target: "w-novel" },
    { source: "k-2", target: "w-gn" }
  ]);
});

test("planTitleFolds leaves a keyless work alone when no keyed work, or several, have its full title", () => {
  assert.deepEqual(planTitleFolds([
    titled(KEY, "w-novel", "Fourth Wing", true, "2026-09-01"),
    titled(KEY, "k-1", "Fourth Wing: The Graphic Novel", false, "2026-09-02")
  ]), []);
  assert.deepEqual(planTitleFolds([
    titled(KEY, "w-a", "Fourth Wing", true, "2026-09-01"),
    titled(KEY, "w-b", "Fourth WIng", true, "2026-09-02"),
    titled(KEY, "k-1", "Fourth Wing", false, "2026-09-03"),
    titled(KEY, "k-2", "Fourth Wing", false, "2026-09-04")
  ]), []);
});

test("planTitleFolds folds only within the keyless work's own title key", () => {
  const other = workTitleKey("Iron Flame", "Rebecca Yarros");
  assert.deepEqual(planTitleFolds([
    titled(other, "w-flame", "Iron Flame", true, "2026-09-01"),
    titled(KEY, "k-1", "Iron Flame", false, "2026-09-02")
  ]), []);
});

test("planTitleFolds never folds works whose title key is empty", () => {
  assert.deepEqual(planTitleFolds([
    titled("", "w-a", "!!!", true, "2026-09-01"),
    titled("", "k-1", "!!!", false, "2026-09-02")
  ]), []);
  assert.deepEqual(planTitleFolds([
    titled(KEY, "k-1", "!!!", false, "2026-09-01"),
    titled(KEY, "k-2", "???", false, "2026-09-02")
  ]), []);
});

test("planTitleFolds keeps a keyless volume apart from the one keyed work whose whole title differs", () => {
  assert.deepEqual(planTitleFolds([
    titled(LUPIN, "w-lupin", "Arsène Lupin: Gentleman Ladrão", true, "2026-09-01"),
    titled(LUPIN, "k-1", "Arsène Lupin: A Agulha Oca", false, "2026-09-02")
  ]), []);
});

test("planTitleFolds folds keyless works with one whole title into the oldest of them, and keeps other whole titles apart", () => {
  assert.deepEqual(planTitleFolds([
    titled(LUPIN, "k-copy", "Arsène Lupin: A Agulha Oca", false, "2026-09-04"),
    titled(LUPIN, "k-crystal", "Arsène Lupin: O Tampão de Cristal", false, "2026-09-03"),
    titled(LUPIN, "k-needle", "Arsène Lupin: A Agulha Oca", false, "2026-09-02"),
    titled(LUPIN, "k-gentleman", "Arsène Lupin: Gentleman Ladrão", false, "2026-09-01")
  ]), [{ source: "k-copy", target: "k-needle" }]);
});

test("planTitleFolds breaks a createdAt tie between keyless works by the lowest work id", () => {
  assert.deepEqual(planTitleFolds([
    titled(KEY, "k-b", "Fourth Wing", false, "2026-09-01"),
    titled(KEY, "k-a", "Fourth Wing", false, "2026-09-01")
  ]), [{ source: "k-b", target: "k-a" }]);
});

test("planTitleFolds matches a keyed work through any of its edition titles", () => {
  const orwell = workTitleKey("1984", "George Orwell");
  assert.deepEqual(planTitleFolds([
    titled(orwell, "w-1984", "1984", true, "2026-09-01"),
    titled(orwell, "w-1984", "Mil Novecentos e Oitenta e Quatro", true, "2026-09-01"),
    titled(orwell, "k-1", "Mil Novecentos e Oitenta e Quatro", false, "2026-09-02")
  ]), [{ source: "k-1", target: "w-1984" }]);
});

test("planTitleFolds ignores bracketed notes", () => {
  const maias = workTitleKey("Os Maias", "Eça de Queirós");
  assert.deepEqual(planTitleFolds([
    titled(maias, "w-maias", "Os Maias", true, "2026-09-01"),
    titled(maias, "k-1", "[EBOOK] Os Maias", false, "2026-09-02")
  ]), [{ source: "k-1", target: "w-maias" }]);
});

test("planTitleFolds folds the keyless works of a crowded key together when no keyed work has their whole title", () => {
  assert.deepEqual(planTitleFolds([
    titled(KEY, "w-novel", "Fourth Wing", true, "2026-09-01"),
    titled(KEY, "k-2", "Fourth Wing: The Graphic Novel", false, "2026-09-03"),
    titled(KEY, "k-1", "Fourth Wing: The Graphic Novel", false, "2026-09-02")
  ]), [{ source: "k-2", target: "k-1" }]);
});

test("planTitleFolds orders folds by title key, then the source's createdAt, then its work id", () => {
  assert.deepEqual(planTitleFolds([
    titled("key-c", "w-c", "Title C", true, "2026-09-01"),
    titled("key-c", "c-1", "Title C", false, "2026-09-02"),
    titled("key-b", "w-b", "Title B", true, "2026-09-01"),
    titled("key-b", "b-late", "Title B", false, "2026-09-05"),
    titled("key-b", "b-y", "Title B", false, "2026-09-03"),
    titled("key-b", "b-x", "Title B", false, "2026-09-03"),
    titled("key-b", "b-early", "Title B", false, "2026-09-01"),
    titled("key-a", "w-a", "Title A", true, "2026-09-09"),
    titled("key-a", "a-1", "Title A", false, "2026-09-10")
  ]), [
    { source: "a-1", target: "w-a" },
    { source: "b-early", target: "w-b" },
    { source: "b-x", target: "w-b" },
    { source: "b-y", target: "w-b" },
    { source: "b-late", target: "w-b" },
    { source: "c-1", target: "w-c" }
  ]);
});
