import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import argon2 from "argon2";

const flags = new Set(process.argv.slice(2));
assert([...flags].every((flag) => ["--reset", "--seed-only", "--check"].includes(flag)), "Use --reset, --seed-only, or --check.");
assert.notEqual(process.env.NODE_ENV, "production", "Fixtures are development-only.");
const checking = flags.has("--check");
const directory = checking ? mkdtempSync(join(tmpdir(), "scripta-three-users-")) : fileURLToPath(new URL("../data/three-users", import.meta.url));
const lock = `${directory}.lock`;
mkdirSync(dirname(directory), { recursive: true });
try {
  mkdirSync(lock);
} catch (error) {
  if (error.code === "EEXIST") throw new Error(`Fixture already in use. If its process crashed, remove ${lock} before retrying.`);
  throw error;
}
process.on("exit", () => {
  rmSync(lock, { recursive: true, force: true });
  if (checking) rmSync(directory, { recursive: true, force: true });
});
if (flags.has("--reset")) rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const manifestPath = join(directory, "fixture.json");
assert(existsSync(manifestPath) || !existsSync(join(directory, "auth.sqlite")), "Incomplete fixture: rerun with --reset.");
const secretsPath = join(directory, "secrets.json");
if (!existsSync(secretsPath)) writeFileSync(secretsPath, JSON.stringify({ JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex") }), { mode: 0o600 });
Object.assign(process.env, JSON.parse(readFileSync(secretsPath, "utf8")), {
  DOTENV_CONFIG_PATH: join(directory, "unused.env"),
  GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_CALLBACK_URL: "", HARDCOVER_API_KEY: "",
  SOCIALS_ENCRYPTION_KEY: "", X_CLIENT_ID: "", INSTAGRAM_CLIENT_ID: "", THREADS_CLIENT_ID: "", TIKTOK_CLIENT_KEY: "",
  ALLOW_LAN_ORIGINS: "true"
});
for (const module of ["auth", "library", "gallery", "covers", "socials", "arena", "murals", "tierlists"]) {
  process.env[`${module.toUpperCase()}_DB_PATH`] = join(directory, `${module}.sqlite`);
}
for (const storage of ["gallery", "avatar", "covers"]) process.env[`${storage.toUpperCase()}_STORAGE_PATH`] = join(directory, `${storage}-files`);
const { buildApp } = await import("../src/app.ts");
const { bookKey } = await import("../../packages/shared/src/library/merge.ts");
const app = buildApp();
await app.ready();
const password = "scripta123";

async function request(method, url, payload, token, expected = 200) {
  const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
  return response.body ? response.json() : null;
}

async function seed() {
  if (existsSync(manifestPath)) {
    const fixture = JSON.parse(readFileSync(manifestPath, "utf8"));
    const db = new DatabaseSync(join(directory, "auth.sqlite"));
    try {
      for (const user of Object.values(fixture.users)) {
        const row = db.prepare("SELECT password_hash FROM users WHERE id = ? AND username = ? AND email = ?").get(user.id, user.username, user.email);
        assert(row?.password_hash, "Fixture account missing: rerun with --reset.");
        if (!await argon2.verify(row.password_hash, password)) {
          db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await argon2.hash(password), user.id);
        }
      }
    } finally {
      db.close();
    }
    return fixture;
  }
  const users = {};
  const tokens = {};
  for (const name of ["alice", "bob", "charlie"]) {
    const username = `fixture_${name}`;
    const email = `${username}@example.test`;
    const session = await request("POST", "/auth/signup", { username, email, password }, null, 201);
    users[name] = { username, email, id: session.user.id };
    tokens[name] = session.accessToken;
  }
  const books = Array.from({ length: 16 }, (_, index) => ({
    ContentID: `fixture-book-${index + 1}`, Title: `The ${["Amber", "Silver", "Quiet", "Hidden"][index % 4]} ${["Harbor", "Garden", "Archive", "Journey"][Math.floor(index / 4)]}`,
    Attribution: `Fixture Author ${index % 4 + 1}`, ReadStatus: index % 3, ___PercentRead: [0, 45, 100][index % 3],
    highlights: [{ BookmarkID: `fixture-highlight-${index + 1}`, Text: "A synthetic passage for testing.", Annotation: "PRIVATE_FIXTURE_NOTE" }]
  }));
  for (const [name, libraryBooks] of [["alice", books.slice(0, 12)], ["bob", [...books.slice(0, 4), ...books.slice(12)]], ["charlie", []]]) {
    await request("PUT", "/library", { data: { source: "three-user-fixture", schema_version: 1, name: `${name}'s library`, book_count: libraryBooks.length, books: libraryBooks } }, tokens[name]);
  }
  const library = await request("POST", "/library/share", {}, tokens.alice);
  const keys = books.slice(0, 4).map(bookKey);
  const murals = {};
  for (const visibility of ["shared", "private"]) {
    let mural = await request("POST", "/murals", { name: `Alice's ${visibility} reading room` }, tokens.alice, 201);
    mural = await request("PUT", `/murals/${mural.id}`, { blocks: [
      { id: "fixture-heading", type: "text", layout: { x: 0, y: 0, w: 6, h: 2 }, heading: `${visibility} reading room`, body: "A synthetic reading collection." },
      { id: "fixture-spotlight", type: "spotlight", layout: { x: 0, y: 3, w: 4, h: 5 }, bookKey: keys[0] },
      { id: "fixture-shelf", type: "shelf", layout: { x: 5, y: 3, w: 7, h: 5 }, title: "Weekend reading", bookKeys: keys }
    ] }, tokens.alice);
    if (visibility === "shared") mural = await request("POST", `/murals/${mural.id}/share`, {}, tokens.alice);
    murals[visibility] = mural;
  }
  const polls = {};
  for (const access of ["members", "anonymous"]) {
    const source = await request("POST", "/tierlists", { name: `Alice's ${access} book poll` }, tokens.alice, 201);
    const tiers = source.data.tiers.map((tier, index) => ({ ...tier, bookKeys: index === 0 ? [keys[0]] : [] }));
    await request("PUT", `/tierlists/${source.id}`, { data: { tiers, pool: keys.slice(1) } }, tokens.alice);
    const { tierlist } = await request("POST", `/tierlists/${source.id}/open-voting`, { access }, tokens.alice, 201);
    const ballot = await request("POST", `/tierlists/voting/${tierlist.voteCode}/ballot`, { placements: [{ bookKey: keys[0], tierId: tiers[1].id }, { bookKey: keys[1], tierId: tiers[0].id }] }, tokens.bob);
    polls[access] = { id: tierlist.id, code: tierlist.voteCode, bobBallotId: ballot.ballotId };
  }
  const { tournament } = await request("POST", "/arenas", { name: "Alice's weekend bracket", bracketSize: 4, roundDurationMinutes: 10080 }, tokens.alice, 201);
  await request("PUT", `/arenas/${tournament.id}/slots`, { slots: books.slice(0, 4).map((book, slotIndex) => ({ slotIndex, book: { key: bookKey(book), title: book.Title, author: book.Attribution, cover: null } })) }, tokens.alice, 204);
  await request("POST", `/arenas/${tournament.id}/start`, {}, tokens.alice, 204);
  const { tournament: arena } = await request("GET", `/arenas/${tournament.id}`);
  const voterToken = "scripta-fixture-bob";
  await request("POST", `/arenas/${arena.id}/duels/${arena.duels[0].id}/vote`, { voterToken, bookKey: arena.duels[0].bookA.key }, null, 204);
  const manifest = { users, library: { shareToken: library.shareToken }, murals, polls, arena: { id: arena.id, bobVoterToken: voterToken } };
  writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2));
  renameSync(`${manifestPath}.tmp`, manifestPath);
  return manifest;
}

async function check(fixture) {
  const tokens = {};
  for (const [name, user] of Object.entries(fixture.users)) tokens[name] = (await request("POST", "/auth/login", { identifier: user.username, password })).accessToken;
  for (const [name, count] of [["alice", 12], ["bob", 8], ["charlie", 0]]) {
    assert.equal((await request("GET", "/library", undefined, tokens[name])).data.books.length, count);
  }
  const aliceBooks = (await request("GET", "/library", undefined, tokens.alice)).data.books.map(bookKey);
  const bobBooks = (await request("GET", "/library", undefined, tokens.bob)).data.books.map(bookKey);
  assert.equal(bobBooks.filter((key) => aliceBooks.includes(key)).length, 4);
  const shared = await request("GET", `/library/shared/${fixture.library.shareToken}`);
  assert(!JSON.stringify(shared).includes("PRIVATE_FIXTURE_NOTE"));
  const mural = fixture.murals.shared;
  const publicMural = await request("GET", `/murals/shared/${mural.shareToken}`);
  assert.equal(publicMural.books.length, 4);
  assert(!JSON.stringify(publicMural).includes("PRIVATE_FIXTURE_NOTE"));
  for (const name of ["bob", "charlie"]) {
    await request("PUT", `/murals/${mural.id}`, { name: "Forbidden" }, tokens[name], 404);
    await request("DELETE", `/tierlists/${fixture.polls.members.id}`, undefined, tokens[name], 404);
    await request("DELETE", `/arenas/${fixture.arena.id}`, undefined, tokens[name], 404);
  }
  const poll = fixture.polls.members;
  await request("POST", `/tierlists/voting/${poll.code}/ballot`, { placements: [] }, null, 401);
  const ballot = await request("GET", `/tierlists/voting/${poll.code}/ballot/${poll.bobBallotId}`, undefined, tokens.bob);
  assert.equal(ballot.placements.length, 2);
  await request("PUT", `/tierlists/voting/${poll.code}/ballot/${poll.bobBallotId}`, { placements: ballot.placements.slice(0, 1) }, tokens.bob);
  assert.equal((await request("GET", `/tierlists/${poll.id}/results`, undefined, tokens.alice)).ballotCount, 2);
  await request("POST", `/tierlists/voting/${poll.code}/ballot`, { placements: ballot.placements }, tokens.charlie);
  assert.equal((await request("GET", `/tierlists/${poll.id}/results`, undefined, tokens.alice)).ballotCount, 3);
  await request("POST", `/tierlists/voting/${fixture.polls.anonymous.code}/ballot`, { placements: [] });
  const { tournament } = await request("GET", `/arenas/${fixture.arena.id}`);
  await request("POST", `/arenas/${tournament.id}/duels/${tournament.duels[0].id}/vote`, { voterToken: fixture.arena.bobVoterToken, bookKey: tournament.duels[0].bookA.key }, null, 409);
  await request("POST", "/library/unshare", {}, tokens.alice);
  await request("GET", `/library/shared/${fixture.library.shareToken}`, undefined, null, 404);
  await request("POST", `/murals/${mural.id}/unshare`, {}, tokens.alice);
  await request("GET", `/murals/shared/${mural.shareToken}`, undefined, null, 404);
  await request("PUT", `/tierlists/${poll.id}/voting`, { open: false }, tokens.alice);
  await request("POST", `/tierlists/voting/${poll.code}/ballot`, { placements: [] }, tokens.charlie, 409);
  const db = new DatabaseSync(join(directory, "auth.sqlite"));
  try {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await argon2.hash("Scripta-fixture-2026!"), fixture.users.bob.id);
  } finally {
    db.close();
  }
  assert.deepEqual(await seed(), fixture);
  await request("POST", "/auth/login", { identifier: fixture.users.bob.username, password });
  assert.equal((await request("GET", `/tierlists/voting/${poll.code}`)).board.votingOpen, false);
  assert.equal((await request("GET", `/library`, undefined, tokens.alice)).shareToken, null);
  console.log("Three-user fixture checks passed: data, privacy, ownership, ballots, duplicate votes, revoked shares, and preserved progress.");
}

try {
  const fixture = await seed();
  if (checking) await check(fixture);
  else {
    const frontend = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    console.log(`\nFixture: ${manifestPath}\nAccounts: fixture_alice, fixture_bob, fixture_charlie\nPassword: ${password}\nLibrary: ${frontend}/shared/library/${fixture.library.shareToken}\nMural: ${frontend}/shared/murals/${fixture.murals.shared.shareToken}\nMembers poll: ${frontend}/vote/${fixture.polls.members.code}\nAnonymous poll: ${frontend}/vote/${fixture.polls.anonymous.code}\nArena: ${frontend}/arena/${fixture.arena.id}\nBob's Arena token: ${fixture.arena.bobVoterToken}\nLinks reflect initial seeding; revoked/deleted content stays that way until --reset.\n`);
  }
  if (checking || flags.has("--seed-only")) await app.close();
  else {
    await app.listen({ port: Number(process.env.PORT || 3000), host: "0.0.0.0" });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await app.close(); process.exit(0); });
  }
} catch (error) {
  await app.close();
  throw error;
}
