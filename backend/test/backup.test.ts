// Proves a snapshot can actually be restored.
//
// A backup that has never been restored is a guess, and the failure mode
// is silent: it looks like it worked every night until the day it matters.
// So this doesn't just assert the file exists — it writes data, snapshots
// a LIVE database (one with an open connection and uncommitted-to-disk
// WAL content, which is what a real backup runs against), restores the
// snapshot to a new path, and reads the data back out.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "node:test";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "atmyshelf-backup-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("sqlite snapshot", () => {
  it("captures data written through a live WAL connection", async () => {
    // The realistic case: the app is running, WAL mode is on, and recent
    // writes are in the -wal file rather than the main database. Copying
    // just the .sqlite here would lose them.
    const source = join(work, "live.sqlite");
    const db = new DatabaseSync(source);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)");
    db.prepare("INSERT INTO users VALUES (?, ?)").run("u1", "a@example.test");
    db.prepare("INSERT INTO users VALUES (?, ?)").run("u2", "b@example.test");

    const snapshot = join(work, "snapshot.sqlite");
    await backup(new DatabaseSync(source, { readOnly: true }), snapshot);
    db.close();

    const restored = new DatabaseSync(snapshot, { readOnly: true });
    const rows = restored.prepare("SELECT id, email FROM users ORDER BY id").all() as Array<{ id: string; email: string }>;
    restored.close();

    assert.equal(rows.length, 2, "writes still in the WAL must be in the snapshot");
    assert.deepEqual(rows.map((r) => r.email), ["a@example.test", "b@example.test"]);
  });

  it("produces a single self-contained file with no sidecars to remember", async () => {
    // Restoring is "put this one file back". If a snapshot needed its -wal
    // alongside it, half the restores done under pressure would lose data.
    const source = join(work, "live.sqlite");
    const db = new DatabaseSync(source);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE t (a)");
    db.prepare("INSERT INTO t VALUES (?)").run("x");

    const snapshot = join(work, "snapshot.sqlite");
    await backup(new DatabaseSync(source, { readOnly: true }), snapshot);
    db.close();

    assert.equal(existsSync(`${snapshot}-wal`), false);
    assert.equal(existsSync(`${snapshot}-shm`), false);
  });

  it("passes SQLite's own integrity check", async () => {
    const source = join(work, "live.sqlite");
    const db = new DatabaseSync(source);
    db.exec("CREATE TABLE t (a)");
    for (let i = 0; i < 500; i++) db.prepare("INSERT INTO t VALUES (?)").run(i);

    const snapshot = join(work, "snapshot.sqlite");
    await backup(new DatabaseSync(source, { readOnly: true }), snapshot);
    db.close();

    const restored = new DatabaseSync(snapshot, { readOnly: true });
    assert.equal((restored.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    assert.equal((restored.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n, 500);
    restored.close();
  });
});

describe("the backup script end to end", () => {
  it("snapshots a real deployment's databases, and they restore", () => {
    // Stand up something shaped like a running deployment: separate files
    // per module, WAL on, real rows.
    const dataDir = join(work, "data");
    const galleryFiles = join(work, "gallery-files");
    execFileSync("mkdir", ["-p", dataDir, galleryFiles]);

    for (const [name, ddl, rows] of [
      ["auth", "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT)", ["u1", "u2", "u3"]],
      ["library", "CREATE TABLE library_settings (user_id TEXT PRIMARY KEY, name TEXT)", ["u1"]],
      ["gallery", "CREATE TABLE gallery_images (id TEXT PRIMARY KEY, user_id TEXT)", ["i1", "i2"]],
      ["covers", "CREATE TABLE cover_cache (id TEXT PRIMARY KEY, cache_key TEXT)", ["c1"]],
      ["socials", "CREATE TABLE connections (id TEXT PRIMARY KEY, provider TEXT)", ["s1"]]
    ] as const) {
      const db = new DatabaseSync(join(dataDir, `${name}.sqlite`));
      db.exec("PRAGMA journal_mode = WAL");
      db.exec(ddl);
      const table = ddl.match(/CREATE TABLE (\w+)/)![1];
      for (const id of rows) db.prepare(`INSERT INTO ${table} VALUES (?, ?)`).run(id, "value");
      db.close();
    }
    execFileSync("sh", ["-c", `echo image > ${join(galleryFiles, "img.webp")}`]);

    const out = join(work, "backups");
    execFileSync(
      "node",
      ["--import", "tsx", "scripts/backup.mjs", "--out", out],
      {
        cwd: backendDir,
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "test",
          AUTH_DB_PATH: join(dataDir, "auth.sqlite"),
          LIBRARY_DB_PATH: join(dataDir, "library.sqlite"),
          GALLERY_DB_PATH: join(dataDir, "gallery.sqlite"),
          COVERS_DB_PATH: join(dataDir, "covers.sqlite"),
          SOCIALS_DB_PATH: join(dataDir, "socials.sqlite"),
          GALLERY_STORAGE_PATH: galleryFiles,
          COVERS_STORAGE_PATH: join(work, "covers-files"),
          // Explicitly local-disk mode, so the script snapshots all five
          // databases rather than deferring library to Postgres.
          DATABASE_URL: "",
          S3_BUCKET: "",
          JWT_ACCESS_SECRET: "test-only-access-secret-not-used-for-anything-real-0000",
          JWT_REFRESH_SECRET: "test-only-refresh-secret-not-used-for-anything-real-000"
        }
      }
    );

    const snapshotDir = join(out, execFileSync("ls", [out]).toString().trim().split("\n")[0]!);
    const manifest = JSON.parse(readFileSync(join(snapshotDir, "manifest.json"), "utf8")) as {
      entries: Array<{ name: string; kind: string; tables?: number }>;
      problems: string[];
      notIncluded: string[];
    };

    assert.deepEqual(manifest.problems, [], "a clean run must report no problems");

    // Every module, not just the obvious one. auth is the file whose loss
    // is unrecoverable, so its presence is the assertion that matters most.
    for (const name of ["auth", "library", "gallery", "covers", "socials"]) {
      const entry = manifest.entries.find((e) => e.name === name);
      assert.ok(entry, `${name} must be in the snapshot`);
      assert.equal(entry.kind, "sqlite");
    }
    assert.ok(manifest.entries.some((e) => e.name === "gallery-files" && e.kind === "files"), "blob directory must be captured");

    // The snapshot must warn that the encryption key is not in it — a
    // restore without that key leaves every social token unreadable.
    assert.ok(
      manifest.notIncluded.some((note) => note.includes("SOCIALS_ENCRYPTION_KEY")),
      "the manifest must record that the encryption key is not included"
    );

    // THE ACTUAL RESTORE: open each snapshot as if it had been put back in
    // place, and read the rows out.
    const restoredUsers = new DatabaseSync(join(snapshotDir, "auth.sqlite"), { readOnly: true });
    assert.equal((restoredUsers.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 3);
    restoredUsers.close();

    const restoredGallery = new DatabaseSync(join(snapshotDir, "gallery.sqlite"), { readOnly: true });
    assert.equal((restoredGallery.prepare("SELECT COUNT(*) AS n FROM gallery_images").get() as { n: number }).n, 2);
    restoredGallery.close();

    // And the blob tarball really contains the file.
    const listing = execFileSync("tar", ["-tzf", join(snapshotDir, "gallery-files.tar.gz")]).toString();
    assert.match(listing, /img\.webp/);

    // No -wal/-shm beside any snapshot. This is checked on the SCRIPT's
    // output rather than on a bare backup() call, because that is where it
    // actually went wrong: verifying a snapshot means opening it, and
    // opening a WAL database creates the sidecars. A snapshot that needs
    // two extra files to be restored correctly is a restore that will go
    // wrong under pressure.
    const produced = execFileSync("ls", [snapshotDir]).toString().trim().split("\n");
    assert.deepEqual(
      produced.filter((f) => f.endsWith("-wal") || f.endsWith("-shm")),
      [],
      "a snapshot must be one self-contained file per database"
    );

    // ...and the restored databases must not be in WAL mode either.
    const mode = new DatabaseSync(join(snapshotDir, "auth.sqlite"), { readOnly: true });
    assert.notEqual((mode.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
    mode.close();
  });

  it("prunes old snapshots but keeps the newest", () => {
    const dataDir = join(work, "data");
    execFileSync("mkdir", ["-p", dataDir]);
    const db = new DatabaseSync(join(dataDir, "auth.sqlite"));
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
    db.close();

    const out = join(work, "backups");
    const run = () =>
      execFileSync("node", ["--import", "tsx", "scripts/backup.mjs", "--out", out, "--keep", "2"], {
        cwd: backendDir,
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "test",
          AUTH_DB_PATH: join(dataDir, "auth.sqlite"),
          LIBRARY_DB_PATH: ":memory:",
          GALLERY_DB_PATH: ":memory:",
          COVERS_DB_PATH: ":memory:",
          SOCIALS_DB_PATH: ":memory:",
          GALLERY_STORAGE_PATH: join(work, "none"),
          COVERS_STORAGE_PATH: join(work, "none2"),
          DATABASE_URL: "",
          S3_BUCKET: "",
          JWT_ACCESS_SECRET: "test-only-access-secret-not-used-for-anything-real-0000",
          JWT_REFRESH_SECRET: "test-only-refresh-secret-not-used-for-anything-real-000"
        }
      });

    run();
    run();
    run();

    const snapshots = execFileSync("ls", [out]).toString().trim().split("\n").filter(Boolean);
    assert.equal(snapshots.length, 2, "--keep 2 must leave exactly two snapshots");
  });
});
