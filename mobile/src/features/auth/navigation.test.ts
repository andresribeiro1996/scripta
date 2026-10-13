import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSignIn, authDestination, finishAuthNavigation, pathWithQuery, startAuthNavigation } from "./navigation";

test("login, Google setup and avatar onboarding retain the requested destination", () => {
  startAuthNavigation("/vote/book?edition=2", false);
  assert.deepEqual(afterSignIn("reader"), { href: "/vote/book?edition=2", withAnchor: true });
  assert.deepEqual(afterSignIn(null), { href: "/choose-username", withAnchor: false });
  startAuthNavigation(authDestination(), true);
  assert.deepEqual(afterSignIn("reader"), { href: "/welcome-avatar", withAnchor: false });
  assert.equal(finishAuthNavigation(), "/vote/book?edition=2");
  assert.equal(authDestination(), "/");
  startAuthNavigation("//evil.test", false);
  assert.deepEqual(afterSignIn("reader"), { href: "/", withAnchor: true });
  assert.equal(pathWithQuery("/library", { search: "a book", returnTo: "/login", initial: "false" }), "/library?search=a+book");
});
