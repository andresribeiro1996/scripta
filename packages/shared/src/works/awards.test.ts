import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIZES, awardLabel, isPrizeKey, knownAwards, prizeLabel, type PrizeKey } from "./awards.js";

test("PRIZES lists the prizes in order with their labels", () => {
  assert.deepEqual(
    (Object.keys(PRIZES) as PrizeKey[]).map((key) => [key, prizeLabel(key, "en")]),
    [
      ["booker", "Booker Prize"],
      ["international-booker", "International Booker Prize"],
      ["hugo-novel", "Hugo Award"],
      ["nebula-novel", "Nebula Award"],
      ["pulitzer-fiction", "Pulitzer Prize for Fiction"],
      ["nobel-literature", "Nobel Prize in Literature"],
      ["camoes", "Prémio Camões"],
      ["leya", "Prémio LeYa"],
      ["saramago", "Prémio José Saramago"],
      ["ape-novel", "Grande Prémio de Romance e Novela APE"]
    ]
  );
});

test("only the Nobel and the Camões honour an author", () => {
  assert.deepEqual(
    Object.entries(PRIZES).filter(([, prize]) => prize.honours === "author").map(([key]) => key),
    ["nobel-literature", "camoes"]
  );
  assert.ok(isPrizeKey("camoes"));
  assert.ok(!isPrizeKey("toString"));
  assert.ok(!isPrizeKey("goodreads-choice"));
});

test("awardLabel names a win and a nomination", () => {
  assert.equal(awardLabel({ prize: "hugo-novel", year: 1993, won: true }, "en"), "Hugo Award 1993");
  assert.equal(awardLabel({ prize: "booker", year: 2019, won: false }, "en"), "Booker Prize 2019 · nominee");
});

test("knownAwards drops unknown keys and sorts wins first, newest first", () => {
  const awards = [
    { prize: "booker", year: 2019, won: false },
    { prize: "goodreads-choice", year: 2024, won: true },
    { prize: "hugo-novel", year: 1993, won: true },
    { prize: "nebula-novel", year: 2001, won: false },
    { prize: "pulitzer-fiction", year: 2005, won: true }
  ];
  assert.deepEqual(knownAwards(awards), [
    { prize: "pulitzer-fiction", year: 2005, won: true },
    { prize: "hugo-novel", year: 1993, won: true },
    { prize: "booker", year: 2019, won: false },
    { prize: "nebula-novel", year: 2001, won: false }
  ]);
  assert.equal(awards.length, 5);
});

test("knownAwards of undefined is empty", () => {
  assert.deepEqual(knownAwards(undefined), []);
});

test("prize names follow the Portuguese press, and Portuguese prizes stay as they are", () => {
  assert.equal(prizeLabel("booker", "pt-PT"), "Prémio Booker");
  assert.equal(prizeLabel("international-booker", "pt-PT"), "Prémio Booker Internacional");
  assert.equal(prizeLabel("nobel-literature", "pt-PT"), "Prémio Nobel da Literatura");
  assert.equal(prizeLabel("camoes", "pt-PT"), "Prémio Camões");
  assert.equal(awardLabel({ prize: "booker", year: 2019, won: false }, "pt-PT"), "Prémio Booker 2019 · nomeado");
});
