import assert from "node:assert/strict";
import { test } from "node:test";
import { apiPath } from "./path.js";

test("plain values pass through", () => {
  assert.equal(apiPath`/arenas/${"abc"}/duels/${"d1"}/vote`, "/arenas/abc/duels/d1/vote");
});

test("reserved characters stay inside one segment", () => {
  assert.equal(apiPath`/murals/shared/${"a/b?c#d e"}`, "/murals/shared/a%2Fb%3Fc%23d%20e");
});

test("non-ASCII usernames are percent-encoded", () => {
  assert.equal(apiPath`/community/profiles/${"zoë"}`, "/community/profiles/zo%C3%AB");
});

test("numbers are stringified", () => {
  assert.equal(apiPath`/x/${3}`, "/x/3");
});
