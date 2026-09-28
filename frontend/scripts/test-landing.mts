import assert from "node:assert/strict";
import { test } from "node:test";
import { landingDestination, modeFromSearch } from "../src/lib/landing.ts";

test("a session routes to the dashboard; a stranger gets the landing page", () => {
  const session = { user: { id: "reader", email: "reader@example.com", username: "reader", avatarId: null }, accessToken: "access", refreshToken: "refresh" };
  assert.equal(landingDestination(session), "/dashboard");
  assert.equal(landingDestination(null), null);
});

test("modeFromSearch reads mode=signup as signup; everything else as login", () => {
  assert.equal(modeFromSearch(new URLSearchParams("mode=signup")), "signup");
  assert.equal(modeFromSearch(new URLSearchParams("mode=login")), "login");
  assert.equal(modeFromSearch(new URLSearchParams("mode=bogus")), "login");
  assert.equal(modeFromSearch(new URLSearchParams("")), "login");
});
