import assert from "node:assert/strict";
import { test } from "node:test";
import { workGenres } from "./workGenres.js";

test("genres rank by how many editions carry them, capped at three", () => {
  assert.deepEqual(workGenres([{ genres: ["Fantasy", "Classics"] }, { genres: ["Classics", "Horror", "Romance"] }, { genres: ["Classics", "Horror"] }]), { genres: ["Classics", "Horror", "Fantasy"], possibleGenres: [] });
});

test("a genre only Jev guessed below the confident line is possible, after the confident ones", () => {
  assert.deepEqual(workGenres([{ genres: ["History"] }, { genres: ["Biography & Memoir"], possible: true }]), { genres: ["History"], possibleGenres: ["Biography & Memoir"] });
});

test("a genre any confident edition carries is not possible", () => {
  assert.deepEqual(workGenres([{ genres: ["History"], possible: true }, { genres: ["History"] }]), { genres: ["History"], possibleGenres: [] });
});

test("possible genres only fill what the cap leaves", () => {
  assert.deepEqual(workGenres([{ genres: ["Fantasy", "Classics", "Horror"] }, { genres: ["Poetry"], possible: true }]).possibleGenres, []);
  assert.deepEqual(workGenres([]), { genres: [], possibleGenres: [] });
});
