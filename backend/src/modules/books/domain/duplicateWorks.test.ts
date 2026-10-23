import assert from "node:assert/strict";
import { test } from "node:test";
import { planCrowdedFolds, planDuplicateSets } from "./duplicateWorks.js";
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

test("a work that absorbed duplicates is not a set on its own", () => {
  assert.deepEqual(planDuplicateSets([{ ...nate("w-a"), absorbed: 2 }], noSeries), plan([]));
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

const crowded = [
  { titleKey: KEY, workId: "w-novel", title: "Fourth Wing", keyed: true },
  { titleKey: KEY, workId: "w-gn", title: "Fourth Wing: The Graphic Novel", keyed: true },
  { titleKey: KEY, workId: "k-1", title: "Fourth wing", keyed: false },
  { titleKey: KEY, workId: "k-2", title: "Fourth Wing: The Graphic Novel", keyed: false }
];

test("folds a keyless work into the one keyed work with its full title", () => {
  assert.deepEqual(planCrowdedFolds(crowded), [
    { source: "k-1", target: "w-novel" },
    { source: "k-2", target: "w-gn" }
  ]);
});

test("leaves a keyless work alone when no keyed work, or several, have its full title", () => {
  assert.deepEqual(planCrowdedFolds([
    { titleKey: KEY, workId: "w-novel", title: "Fourth Wing", keyed: true },
    { titleKey: KEY, workId: "k-1", title: "Fourth Wing: The Graphic Novel", keyed: false }
  ]), []);
  assert.deepEqual(planCrowdedFolds([
    { titleKey: KEY, workId: "w-a", title: "Fourth Wing", keyed: true },
    { titleKey: KEY, workId: "w-b", title: "Fourth WIng", keyed: true },
    { titleKey: KEY, workId: "k-1", title: "Fourth Wing", keyed: false }
  ]), []);
});

test("folds only within the keyless work's own title key", () => {
  const other = workTitleKey("Iron Flame", "Rebecca Yarros");
  assert.deepEqual(planCrowdedFolds([
    { titleKey: other, workId: "w-flame", title: "Iron Flame", keyed: true },
    { titleKey: KEY, workId: "k-1", title: "Iron Flame", keyed: false }
  ]), []);
});

test("never folds works whose title key is empty", () => {
  assert.deepEqual(planCrowdedFolds([
    { titleKey: "", workId: "w-a", title: "!!!", keyed: true },
    { titleKey: "", workId: "k-1", title: "!!!", keyed: false }
  ]), []);
});
