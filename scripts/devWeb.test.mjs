import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { devDataDirEnv } from "./devDataDir.mjs";
import { portsFromEnvLocal, readDevUserId, webBackendEnv, webUrls } from "./devWeb.mjs";

test("urls use localhost and follow the cert scheme", () => {
  assert.deepEqual(webUrls({ vitePort: 5174, apiPort: 3001, https: false }), { web: "http://localhost:5174", api: "http://localhost:3001" });
  assert.deepEqual(webUrls({ vitePort: 5174, apiPort: 3001, https: true }), { web: "https://localhost:5174", api: "https://localhost:3001" });
});

test("ports come from frontend/.env.local", () => {
  assert.deepEqual(portsFromEnvLocal("VITE_PORT=5174\nVITE_API_PORT=3001\n"), { vitePort: 5174, apiPort: 3001 });
  assert.throws(() => portsFromEnvLocal("VITE_PORT=5174\n"), /VITE_API_PORT.*dev-web\.mjs/s);
});

test("the dev user's id is read by email, and a missing user throws", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "dev-web-")), "auth.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)");
  db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("u-1", "scripta-dev@local.test");
  db.close();
  assert.equal(readDevUserId(dbPath, "scripta-dev@local.test"), "u-1");
  assert.throws(() => readDevUserId(dbPath, "nobody@local.test"), /nobody@local\.test/);
});

test("the backend env carries the admin id, and https settings only with certs", () => {
  const base = { adminUserId: "u-1", vitePort: 5174, apiPort: 3001, certPath: "/c.pem", keyPath: "/k.pem" };
  const plain = webBackendEnv({ ...base, https: false });
  assert.equal(plain.ADMIN_USER_ID, "u-1");
  assert.equal(plain.AUTH_DB_PATH, devDataDirEnv().AUTH_DB_PATH);
  assert.equal(plain.DEV_HTTPS_CERT_PATH, undefined);
  assert.equal(plain.FRONTEND_URL, undefined);
  const secure = webBackendEnv({ ...base, https: true });
  assert.equal(secure.DEV_HTTPS_CERT_PATH, "/c.pem");
  assert.equal(secure.DEV_HTTPS_KEY_PATH, "/k.pem");
  assert.equal(secure.FRONTEND_URL, "https://localhost:5174");
  assert.equal(secure.PUBLIC_API_URL, "https://localhost:3001");
});
