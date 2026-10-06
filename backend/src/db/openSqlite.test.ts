import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSqlite } from "./openSqlite.js";

test("openSqlite creates the folder and opens in WAL with synchronous NORMAL and a 5 s busy timeout", () => {
  const path = join(mkdtempSync(join(tmpdir(), "open-sqlite-")), "nested", "x.sqlite");
  const db = openSqlite(path);
  const pragma = (name: string) => ({ ...(db.prepare(`PRAGMA ${name}`).get() as object) });
  assert.deepEqual(pragma("journal_mode"), { journal_mode: "wal" });
  assert.deepEqual(pragma("synchronous"), { synchronous: 1 });
  assert.deepEqual(pragma("busy_timeout"), { timeout: 5000 });
  db.close();
});
