import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openSqlite } from "./openSqlite.js";

const script = fileURLToPath(new URL("../../scripts/truncate-wals.mjs", import.meta.url));

function run(...paths: string[]): string {
  return execFileSync(process.execPath, [script, ...paths], { encoding: "utf8" });
}

function openWithFrames(path: string) {
  const db = openSqlite(path);
  db.exec("PRAGMA wal_autocheckpoint = 0");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
  db.exec("BEGIN");
  const insert = db.prepare("INSERT INTO t (v) VALUES (?)");
  for (let i = 0; i < 500; i++) insert.run(`row ${i}`);
  db.exec("COMMIT");
  return db;
}

test("a WAL that holds frames is checkpointed and removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "truncate-wals-"));
  const a = join(dir, "a.sqlite");
  const b = join(dir, "b.sqlite");
  const writer = openWithFrames(a);
  copyFileSync(a, b);
  copyFileSync(`${a}-wal`, `${b}-wal`);
  const walBytes = statSync(`${b}-wal`).size;
  assert.ok(walBytes > 0);
  writer.close();

  assert.equal(run(b), `truncate-wals: ${b} wal_bytes=${walBytes}\n`);

  assert.ok(!existsSync(`${b}-wal`) || statSync(`${b}-wal`).size === 0);
  const reader = new DatabaseSync(b, { readOnly: true });
  assert.deepEqual({ ...(reader.prepare("SELECT COUNT(*) AS n FROM t").get() as object) }, { n: 500 });
  reader.close();
});

test("a missing path is skipped", () => {
  const missing = join(mkdtempSync(join(tmpdir(), "truncate-wals-")), "missing.sqlite");
  assert.equal(run(missing), "");
  assert.ok(!existsSync(missing));
});

test("a busy checkpoint is reported, not thrown", () => {
  const c = join(mkdtempSync(join(tmpdir(), "truncate-wals-")), "c.sqlite");
  const holder = openWithFrames(c);
  holder.exec("BEGIN");
  holder.prepare("SELECT COUNT(*) FROM t").get();

  const walBytes = statSync(`${c}-wal`).size;
  assert.equal(run(c), `truncate-wals: ${c} wal_bytes=${walBytes} busy, WAL left in place\n`);
  assert.ok(statSync(`${c}-wal`).size > 0);
  holder.close();
});
