import assert from "node:assert/strict";
import { test } from "node:test";
import { personCaption, suggestionReason } from "./helpers.js";
import type { PersonResult, SuggestedReader } from "./types.js";

test("suggestionReason counts the shared books, singular or plural", () => {
  assert.equal(suggestionReason({ sharedCount: 6 }), "You share 6 books");
  assert.equal(suggestionReason({ sharedCount: 1 }), "You share 1 book");
});

test("suggestionReason says Recently active when no books are shared", () => {
  assert.equal(suggestionReason({ sharedCount: 0 }), "Recently active");
});

const person = (overrides: Partial<PersonResult> = {}): PersonResult => ({ user: { username: "reader", avatarUrl: null, userId: "u1" }, followerCount: 0, private: false, ...overrides });
const suggestion = (sharedCount: number): SuggestedReader => ({ ...person(), sharedCount, sharedBooks: [] });

test("personCaption gives a suggestion that shares books its reason", () => {
  assert.equal(personCaption(suggestion(3)), "You share 3 books");
});

test("personCaption gives a suggestion that shares none Recently active", () => {
  assert.equal(personCaption(suggestion(0)), "Recently active");
});

test("personCaption says Private for a private person, whatever their followers", () => {
  assert.equal(personCaption(person({ private: true, followerCount: 4 })), "Private");
});

test("personCaption counts one follower in the singular", () => {
  assert.equal(personCaption(person({ followerCount: 1 })), "1 follower");
});

test("personCaption counts zero followers in the plural", () => {
  assert.equal(personCaption(person({ followerCount: 0 })), "0 followers");
});

test("personCaption counts two followers in the plural", () => {
  assert.equal(personCaption(person({ followerCount: 2 })), "2 followers");
});
