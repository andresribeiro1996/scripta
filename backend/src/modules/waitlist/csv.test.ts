import assert from "node:assert/strict";
import { test } from "node:test";
import { waitlistCsv } from "./csv.js";

test("the export is a header row then one row per address, in the order given", () => {
  const csv = waitlistCsv([
    { email: "first@example.com", createdAt: "2026-09-27T10:00:00.000Z" },
    { email: "second@example.com", createdAt: "2026-09-27T11:00:00.000Z" }
  ]);
  assert.equal(csv, "email,created_at\nfirst@example.com,2026-09-27T10:00:00.000Z\nsecond@example.com,2026-09-27T11:00:00.000Z\n");
});

test("an empty list still exports the header", () => {
  assert.equal(waitlistCsv([]), "email,created_at\n");
});

test("a value with a comma or quote is quoted so it stays one field", () => {
  assert.equal(waitlistCsv([{ email: 'a,"b"@example.com', createdAt: "t" }]), 'email,created_at\n"a,""b""@example.com",t\n');
});
