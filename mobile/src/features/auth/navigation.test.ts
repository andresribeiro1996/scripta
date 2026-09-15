import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSignIn, authDestination, finishAuthNavigation, pathWithQuery, startAuthNavigation } from "./navigation";

test("login, Google setup and avatar onboarding retain the requested destination", () => {
  startAuthNavigation("/vote/book?edition=2", false);
  assert.equal(afterSignIn("reader"), "/vote/book?edition=2");
  assert.equal(afterSignIn(null), "/choose-username");
  startAuthNavigation(authDestination(), true);
  assert.equal(afterSignIn("reader"), "/welcome-avatar");
  assert.equal(finishAuthNavigation(), "/vote/book?edition=2");
  assert.equal(authDestination(), "/");
  startAuthNavigation("//evil.test", false);
  assert.equal(afterSignIn("reader"), "/");
  assert.equal(pathWithQuery("/library", { search: "a book", returnTo: "/login" }), "/library?search=a+book");
});
