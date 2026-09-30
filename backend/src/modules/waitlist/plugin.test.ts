import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import Fastify from "fastify";

const scratchDir = mkdtempSync(join(tmpdir(), "waitlist-plugin-test-"));
const dbPath = join(scratchDir, "waitlist.sqlite");
process.env.WAITLIST_DB_PATH = dbPath;
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { waitlistPlugin } = await import("./plugin.js");

function countMatching(email: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    return (db.prepare("SELECT COUNT(*) as c FROM waitlist_entries WHERE email = ?").get(email) as { c: number }).c;
  } finally {
    db.close();
  }
}

test("POST /waitlist with a new address stores it normalised and returns 204", async () => {
  const app = Fastify();
  await app.register(waitlistPlugin);
  await app.ready();
  try {
    const res = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "  Reader@Example.com  " } });
    assert.equal(res.statusCode, 204);
    assert.equal(countMatching("reader@example.com"), 1);
  } finally {
    await app.close();
  }
});

test("the same address with different case/whitespace still 204s and stays one row", async () => {
  const app = Fastify();
  await app.register(waitlistPlugin);
  await app.ready();
  try {
    const first = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "again@example.com" } });
    const second = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "  AGAIN@Example.com" } });
    assert.equal(first.statusCode, 204);
    assert.equal(second.statusCode, 204);
    assert.equal(countMatching("again@example.com"), 1);
  } finally {
    await app.close();
  }
});

test("an invalid email 400s with field \"email\" and stores nothing", async () => {
  const app = Fastify();
  await app.register(waitlistPlugin);
  await app.ready();
  try {
    const res = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "not-an-email" } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().field, "email");
    assert.equal(countMatching("not-an-email"), 0);
  } finally {
    await app.close();
  }
});

test("a missing body 400s", async () => {
  const app = Fastify();
  await app.register(waitlistPlugin);
  await app.ready();
  try {
    const res = await app.inject({ method: "POST", url: "/waitlist" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().field, "email");
  } finally {
    await app.close();
  }
});

test("per-IP rate limit 429s after 5 requests in a minute", async () => {
  const app = Fastify();
  await app.register(waitlistPlugin);
  await app.ready();
  try {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "POST", url: "/waitlist", payload: { email: `limit${i}@example.com` } });
      assert.equal(res.statusCode, 204);
    }
    const limited = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "limit5@example.com" } });
    assert.equal(limited.statusCode, 429);
  } finally {
    await app.close();
  }
});

test("the repository lists every stored address oldest first, normalised as the route stored it", async () => {
  const app = Fastify();
  await app.register(waitlistPlugin);
  await app.ready();
  try {
    await app.inject({ method: "POST", url: "/waitlist", payload: { email: "  Listed-One@Example.com" } });
    await app.inject({ method: "POST", url: "/waitlist", payload: { email: "listed-two@example.com" } });
  } finally {
    await app.close();
  }
  const { createSqliteWaitlistRepository } = await import("./adapters/sqlite/sqliteWaitlistRepository.js");
  const db = new DatabaseSync(dbPath);
  try {
    const listed = createSqliteWaitlistRepository(db).list().map((entry) => entry.email).filter((email) => email.startsWith("listed-"));
    assert.deepEqual(listed, ["listed-one@example.com", "listed-two@example.com"]);
  } finally {
    db.close();
  }
});

function recordingSender(fail = false) {
  const sent: { to: string; subject: string; text: string }[] = [];
  const sendEmail = async (to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
    if (fail) throw new Error("provider down");
  };
  return { sent, sendEmail };
}

test("a new address gets one confirmation email, and joining again sends none", async () => {
  const { sent, sendEmail } = recordingSender();
  const app = Fastify();
  await app.register(waitlistPlugin, { sendEmail });
  await app.ready();
  try {
    const first = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "  Confirm@Example.com" } });
    const again = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "confirm@example.com" } });
    assert.equal(first.statusCode, 204);
    assert.equal(again.statusCode, 204);
    const [mail, ...rest] = sent;
    assert.equal(rest.length, 0);
    assert.equal(mail?.to, "confirm@example.com");
    assert.match(mail?.subject ?? "", /launch list/);
    assert.match(mail?.text ?? "", /confirm@example\.com/);
  } finally {
    await app.close();
  }
});

test("an invalid address sends no email", async () => {
  const { sent, sendEmail } = recordingSender();
  const app = Fastify();
  await app.register(waitlistPlugin, { sendEmail });
  await app.ready();
  try {
    await app.inject({ method: "POST", url: "/waitlist", payload: { email: "not-an-email" } });
    assert.equal(sent.length, 0);
  } finally {
    await app.close();
  }
});

test("a failed confirmation email still keeps the signup", async () => {
  const { sent, sendEmail } = recordingSender(true);
  const app = Fastify();
  await app.register(waitlistPlugin, { sendEmail });
  await app.ready();
  try {
    const res = await app.inject({ method: "POST", url: "/waitlist", payload: { email: "unlucky@example.com" } });
    assert.equal(res.statusCode, 204);
    assert.equal(sent.length, 1);
    assert.equal(countMatching("unlucky@example.com"), 1);
  } finally {
    await app.close();
  }
});
