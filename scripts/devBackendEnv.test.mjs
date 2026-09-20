/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeMismatch, mismatchedEnv, parseProcEnviron, parsePsEnv, readProcessEnv } from "./devBackendEnv.mjs";

const PS_OUTPUT = `  PID TTY      STAT   TIME COMMAND
61560 ??       S      0:03.21 node server.js AUTH_DB_PATH=/repo/backend/data/dev/auth.sqlite ARENA_DB_PATH=/repo/backend/data/dev/arena.sqlite PATH=/usr/bin:/bin
`;

test("ps output parses into the variables the check compares", () => {
  const env = parsePsEnv(PS_OUTPUT);
  assert.equal(env.AUTH_DB_PATH, "/repo/backend/data/dev/auth.sqlite");
  assert.equal(env.ARENA_DB_PATH, "/repo/backend/data/dev/arena.sqlite");
  assert.equal(env.PATH, "/usr/bin:/bin");
});

test("a value containing a space survives, because ps gives no quoting to split on", () => {
  const env = parsePsEnv("1 ?? S 0:01 node LIBRARY_DB_PATH=/Users/a b/data/library.sqlite PORT=3000");
  assert.equal(env.LIBRARY_DB_PATH, "/Users/a b/data/library.sqlite");
  assert.equal(env.PORT, "3000");
});

test("proc environ parses its NUL-separated pairs", () => {
  const env = parseProcEnviron("AUTH_DB_PATH=/dev/auth.sqlite\0PORT=3000\0");
  assert.deepEqual(env, { AUTH_DB_PATH: "/dev/auth.sqlite", PORT: "3000" });
});

test("only the expected keys are compared, and a missing one is the mismatch to catch", () => {
  const running = { AUTH_DB_PATH: "/dev/auth.sqlite", UNRELATED: "whatever" };
  // The real bug this exists for: the var was never set on the running
  // process because the module was missing from the list that sets it.
  const rows = mismatchedEnv(running, { AUTH_DB_PATH: "/dev/auth.sqlite", COMMUNITY_DB_PATH: "/dev/community.sqlite" });
  assert.deepEqual(rows, [{ name: "COMMUNITY_DB_PATH", expected: "/dev/community.sqlite", actual: null }]);
});

test("an environment that matches raises nothing", () => {
  assert.deepEqual(mismatchedEnv({ AUTH_DB_PATH: "/dev/auth.sqlite" }, { AUTH_DB_PATH: "/dev/auth.sqlite" }), []);
});

test("the message names the variable and how to get out of it", () => {
  const message = describeMismatch(3000, [{ name: "COMMUNITY_DB_PATH", expected: "/dev/community.sqlite", actual: null }]);
  assert.match(message, /COMMUNITY_DB_PATH/);
  assert.match(message, /\(not set\)/);
  assert.match(message, /npm run dev:release/);
});

test("an unreadable process reads as unknown rather than as a mismatch", () => {
  const env = readProcessEnv(999999, {
    readFile() { throw new Error("no /proc here"); },
    exec() { throw new Error("no such process"); },
  });
  assert.equal(env, null);
});
