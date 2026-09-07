// Pure unit tests — no env sandboxing needed, this module has zero
// imports of its own. This is the exact check plugin.ts's
// generateStateFunction runs against a starting /auth/google request's
// `redirect_target` query param before ever creating a flow for it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedRedirectTarget, parseMobileRedirectAllowlist } from "./mobileRedirectAllowlist.js";

test("parses a comma-separated allowlist, trimming whitespace", () => {
  const parsed = parseMobileRedirectAllowlist(" scripta://oauth-redirect , https://app.example.com/oauth-mobile-callback ");
  assert.deepEqual(parsed, ["scripta://oauth-redirect", "https://app.example.com/oauth-mobile-callback"]);
});

test("drops blank entries from a trailing comma or an unset env var", () => {
  assert.deepEqual(parseMobileRedirectAllowlist(""), []);
  assert.deepEqual(parseMobileRedirectAllowlist("scripta://oauth-redirect,"), ["scripta://oauth-redirect"]);
});

test("a redirect target on the allowlist is allowed", () => {
  const allowlist = parseMobileRedirectAllowlist("scripta://oauth-redirect,https://app.example.com/oauth-mobile-callback");
  assert.equal(isAllowedRedirectTarget("scripta://oauth-redirect", allowlist), true);
});

// The redirect target itself must always come from this fixed list, never
// from a request parameter — a request can only SELECT among the fixed
// entries by exact match.
test("a redirect target not on the allowlist is rejected", () => {
  const allowlist = parseMobileRedirectAllowlist("scripta://oauth-redirect");
  assert.equal(isAllowedRedirectTarget("evil://phish-me", allowlist), false);
});

test("matching is exact, not origin-only — a different path on an allowed https origin is still rejected", () => {
  const allowlist = parseMobileRedirectAllowlist("https://app.example.com/oauth-mobile-callback");
  assert.equal(isAllowedRedirectTarget("https://app.example.com/some-other-path", allowlist), false);
});

test("an empty allowlist allows nothing", () => {
  assert.equal(isAllowedRedirectTarget("scripta://oauth-redirect", []), false);
});
