// backend/src/modules/auth/service.test.ts
//
// Exercises service.ts's avatar methods against a hand-written in-memory
// AuthRepository fake and an in-memory AvatarBlobStore — no real SQLite or
// filesystem, same seam every other module's service tests use. Real sharp
// encoding IS exercised (that's the pipeline under test); only storage is
// faked.

import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { AvatarDimensionsTooLargeError, AvatarTooLargeError, InvalidAvatarError, InvalidRefreshTokenError } from "./domain/errors.js";
import type { AuthRepository, AvatarBlobStore } from "./domain/ports.js";
import type { RefreshTokenRow, UserRow } from "./domain/types.js";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDir = mkdtempSync(join(tmpdir(), "auth-service-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { createAuthService, createUserDataEraser, REFRESH_ROTATION_GRACE_MS } = await import("./service.js");

function createInMemoryRepo(): AuthRepository & { rows: Map<string, UserRow>; refreshTokens: Map<string, RefreshTokenRow> } {
  const rows = new Map<string, UserRow>();
  const refreshTokens = new Map<string, RefreshTokenRow>();
  let nextRefreshTokenId = 1;

  return {
    saveAccountToken() { throw new Error("Unused in this test"); },
    revokeSessions() { throw new Error("Unused in this test"); },
    deleteUser() { throw new Error("Unused in this test"); },
    findAccountToken() { throw new Error("Unused in this test"); },
    completePasswordReset() { throw new Error("Unused in this test"); },
    changePassword() { throw new Error("Unused in this test"); },
    verifyEmail() { throw new Error("Unused in this test"); },
    markEmailVerified() { throw new Error("Unused in this test"); },
    setAppearance(userId, fields) {
      const row = rows.get(userId);
      if (!row) return;
      rows.set(userId, {
        ...row,
        theme: fields.theme ?? row.theme,
        display_font: fields.display_font ?? row.display_font,
        text_font: fields.text_font ?? row.text_font,
      });
    },
    rows,
    refreshTokens,
    createUser(input) {
      const row: UserRow = {
        id: `user-${rows.size + 1}`,
        email: input.email,
        username: input.username,
        password_hash: input.passwordHash,
        google_id: input.googleId,
        avatar_id: null,
        created_at: new Date().toISOString()
      };
      rows.set(row.id, row);
      return row;
    },
    findUserByEmail(email) {
      return [...rows.values()].find((row) => row.email === email);
    },
    findUserByUsername(username) {
      return [...rows.values()].find((row) => row.username === username);
    },
    findUserById(id) {
      return rows.get(id);
    },
    findUserByGoogleId(googleId) {
      return [...rows.values()].find((row) => row.google_id === googleId);
    },
    linkGoogleId(userId, googleId) {
      const row = rows.get(userId);
      if (row) rows.set(userId, { ...row, google_id: googleId });
    },
    setUsername(userId, username) {
      const row = rows.get(userId);
      if (row) rows.set(userId, { ...row, username });
    },
    setAvatarId(userId, avatarId) {
      const row = rows.get(userId);
      if (row) rows.set(userId, { ...row, avatar_id: avatarId });
    },
    insertRefreshToken(input) {
      const id = `refresh-${nextRefreshTokenId++}`;
      refreshTokens.set(id, {
        id,
        user_id: input.userId,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt.toISOString(),
        revoked_at: null,
        rotated_at: null,
        replaced_by: null,
        granted_via_grace: input.grantedViaGrace ? 1 : 0,
        created_at: new Date().toISOString()
      });
      return id;
    },
    findRefreshTokenByHash(tokenHash) {
      return [...refreshTokens.values()].find((row) => row.token_hash === tokenHash);
    },
    findRefreshTokenById(id) {
      return refreshTokens.get(id);
    },
    revokeRefreshToken(id) {
      const row = refreshTokens.get(id);
      if (row) refreshTokens.set(id, { ...row, revoked_at: new Date().toISOString() });
    },
    rotateRefreshToken(id, replacedByTokenId, options) {
      const row = refreshTokens.get(id);
      if (row) {
        const now = new Date().toISOString();
        refreshTokens.set(id, {
          ...row,
          revoked_at: now,
          rotated_at: now,
          replaced_by: replacedByTokenId,
          granted_via_grace: options?.grantedViaGrace ? 1 : 0
        });
      }
    },
    revokeAllRefreshTokensForUser(userId) {
      for (const [id, row] of refreshTokens) {
        if (row.user_id === userId && !row.revoked_at) {
          refreshTokens.set(id, { ...row, revoked_at: new Date().toISOString() });
        }
      }
    }
  };
}

function createInMemoryBlobStore(): AvatarBlobStore & { saved: Map<string, Buffer> } {
  const saved = new Map<string, Buffer>();
  return {
    saved,
    save: async (avatarId, bytes) => {
      saved.set(avatarId, bytes);
    },
    delete: async (avatarId) => {
      saved.delete(avatarId);
    }
  };
}

function makeService() {
  const repo = createInMemoryRepo();
  const blobStore = createInMemoryBlobStore();
  return { service: createAuthService(repo, blobStore), repo, blobStore };
}

async function pngBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 168, g: 92, b: 50 } }
  })
    .png()
    .toBuffer();
}

test("setAvatar stores a re-encoded square webp and returns the fresh user", async () => {
  const { service, repo, blobStore } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  const updated = await service.setAvatar(user.id, await pngBuffer(300, 200));

  assert.ok(updated.avatarId);
  assert.equal(repo.rows.get(user.id)?.avatar_id, updated.avatarId);
  const stored = blobStore.saved.get(updated.avatarId!);
  assert.ok(stored);
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
});

test("setAvatar replaces a previous avatar and deletes the old blob", async () => {
  const { service, repo, blobStore } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  const first = await service.setAvatar(user.id, await pngBuffer(100, 100));
  const second = await service.setAvatar(user.id, await pngBuffer(120, 90));

  assert.notEqual(first.avatarId, second.avatarId);
  assert.equal(repo.rows.get(user.id)?.avatar_id, second.avatarId);
  assert.equal(blobStore.saved.has(first.avatarId!), false);
});

test("removeAvatar clears the column and deletes the blob", async () => {
  const { service, repo, blobStore } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  const { avatarId } = await service.setAvatar(user.id, await pngBuffer(100, 100));

  const removed = await service.removeAvatar(user.id);

  assert.equal(removed.avatarId, null);
  assert.equal(repo.rows.get(user.id)?.avatar_id, null);
  assert.equal(blobStore.saved.has(avatarId!), false);
});

test("removeAvatar on an account with no avatar is a no-op success", async () => {
  const { service, repo } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  const removed = await service.removeAvatar(user.id);

  assert.equal(removed.avatarId, null);
});

test("setAvatar rejects bytes that are not an image", async () => {
  const { service, repo } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  await assert.rejects(service.setAvatar(user.id, Buffer.from("definitely not an image")), InvalidAvatarError);
});

test("setAvatar rejects a buffer over the size cap before doing any work", async () => {
  const { service, repo } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  await assert.rejects(service.setAvatar(user.id, Buffer.alloc(6 * 1024 * 1024)), AvatarTooLargeError);
});

test("setAvatar rejects decompression-bomb-sized dimensions", async () => {
  const { service, repo } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  await assert.rejects(service.setAvatar(user.id, await pngBuffer(9000, 1)), AvatarDimensionsTooLargeError);
});

test("setAvatar whose save rejects leaves avatar_id unchanged", async () => {
  const repo = createInMemoryRepo();
  const failing = { ...createInMemoryBlobStore(), save: async () => { throw new Error("r2 down"); } };
  const service = createAuthService(repo, failing);
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  await assert.rejects(service.setAvatar(user.id, await pngBuffer(100, 100)), /r2 down/);

  assert.equal(repo.rows.get(user.id)?.avatar_id, null);
});

test("removeAvatar whose delete rejects propagates the error", async () => {
  const repo = createInMemoryRepo();
  const store = createInMemoryBlobStore();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  await createAuthService(repo, store).setAvatar(user.id, await pngBuffer(100, 100));
  const service = createAuthService(repo, { ...store, delete: async () => { throw new Error("r2 down"); } });

  await assert.rejects(service.removeAvatar(user.id), /r2 down/);
});

test("erasing an account deletes its avatar blob before the other modules' data", async () => {
  const repo = createInMemoryRepo();
  const store = createInMemoryBlobStore();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  const { avatarId } = await createAuthService(repo, store).setAvatar(user.id, await pngBuffer(100, 100));
  const events: string[] = [];

  await createUserDataEraser(repo, { ...store, delete: async (id) => { events.push(`delete ${id}`); } }, async (id) => { await Promise.resolve(); events.push(`erase ${id}`); })(user.id);

  assert.deepEqual(events, [`delete ${avatarId}`, `erase ${user.id}`]);
});

test("erasing an account with no avatar deletes no blob", async () => {
  const repo = createInMemoryRepo();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  const failing = { ...createInMemoryBlobStore(), delete: async () => { throw new Error("unexpected"); } };

  await createUserDataEraser(repo, failing, async () => {})(user.id);
});

test("erasing an account whose avatar delete rejects propagates the error", async () => {
  const repo = createInMemoryRepo();
  const store = createInMemoryBlobStore();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  await createAuthService(repo, store).setAvatar(user.id, await pngBuffer(100, 100));

  await assert.rejects(createUserDataEraser(repo, { ...store, delete: async () => { throw new Error("r2 down"); } }, async () => {})(user.id), /r2 down/);
});

test("erasing an account whose avatar delete rejects leaves the other modules' data alone", async () => {
  const repo = createInMemoryRepo();
  const store = createInMemoryBlobStore();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  await createAuthService(repo, store).setAvatar(user.id, await pngBuffer(100, 100));
  let erased = false;

  await assert.rejects(createUserDataEraser(repo, { ...store, delete: async () => { throw new Error("r2 down"); } }, async () => { erased = true; })(user.id), /r2 down/);

  assert.equal(erased, false);
});

// --- Task 4A: refresh-rotation grace window --------------------------------
// See service.ts's own comment on refresh() for the full reasoning: mobile
// keeps its access token in memory only and refreshes on nearly every cold
// start, so a rotation response lost in flight must not look like a stolen
// token and sign the account out everywhere (desktop PWA included).

const { hashRefreshToken } = await import("./tokens.js");

function findRowByToken(repo: ReturnType<typeof createInMemoryRepo>, token: string): RefreshTokenRow | undefined {
  const hash = hashRefreshToken(token);
  return [...repo.refreshTokens.values()].find((row) => row.token_hash === hash);
}

test("an unknown refresh token is rejected", async () => {
  const { service } = makeService();
  await assert.rejects(service.refresh("no-such-token"), InvalidRefreshTokenError);
});

test("an expired (but never revoked) refresh token is rejected without triggering revoke-all", async () => {
  const { service, repo } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");
  const second = await service.login("a@b.c", "password123");

  const row = findRowByToken(repo, tokens.refreshToken)!;
  repo.refreshTokens.set(row.id, { ...row, expires_at: new Date(Date.now() - 1000).toISOString() });

  await assert.rejects(service.refresh(tokens.refreshToken), InvalidRefreshTokenError);

  // Session expiry alone (never presented after being revoked) is not the
  // theft/replay signal — it must not cost the user their other sessions.
  const secondRow = findRowByToken(repo, second.tokens.refreshToken);
  assert.equal(secondRow?.revoked_at, null);
});

test("refresh rotates a valid token and returns a fresh pair", async () => {
  const { service } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");

  const rotated = await service.refresh(tokens.refreshToken);

  assert.ok(rotated.accessToken);
  assert.notEqual(rotated.refreshToken, tokens.refreshToken);
});

test("presenting an already-rotated token again within the grace window reissues instead of revoking every session", async () => {
  const { service, repo } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");

  const first = await service.refresh(tokens.refreshToken);
  // The client never actually received `first` (response lost in flight)
  // and retries with the original token, shortly after.
  const reissued = await service.refresh(tokens.refreshToken);

  assert.notEqual(reissued.refreshToken, tokens.refreshToken);
  assert.notEqual(reissued.refreshToken, first.refreshToken);

  const originalRow = findRowByToken(repo, tokens.refreshToken);
  assert.ok(originalRow?.revoked_at);
  assert.ok(originalRow?.rotated_at);

  // The pair the client never received is chained forward rather than
  // left as a live, unused, never-expiring session.
  const firstRow = findRowByToken(repo, first.refreshToken);
  assert.ok(firstRow?.revoked_at);

  const reissuedRow = findRowByToken(repo, reissued.refreshToken);
  assert.equal(reissuedRow?.revoked_at, null);
});

test("presenting an already-rotated token again after the grace window revokes every session", async () => {
  const { service, repo } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");
  // A second, independent session for the same account (e.g. the desktop
  // PWA) — this must survive a mobile retry INSIDE the window, and must
  // NOT survive one outside it.
  const second = await service.login("a@b.c", "password123");

  await service.refresh(tokens.refreshToken);

  const originalRow = findRowByToken(repo, tokens.refreshToken)!;
  repo.refreshTokens.set(originalRow.id, {
    ...originalRow,
    rotated_at: new Date(Date.now() - REFRESH_ROTATION_GRACE_MS - 5_000).toISOString()
  });

  await assert.rejects(service.refresh(tokens.refreshToken), InvalidRefreshTokenError);

  const secondRow = findRowByToken(repo, second.tokens.refreshToken);
  assert.ok(secondRow?.revoked_at, "outside the grace window this is the real theft/replay response: revoke everything");
});

test("a logout-revoked token always revokes every session, even presented immediately", async () => {
  const { service, repo } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");
  const second = await service.login("a@b.c", "password123");

  service.logout(tokens.refreshToken);

  await assert.rejects(service.refresh(tokens.refreshToken), InvalidRefreshTokenError);

  const secondRow = findRowByToken(repo, second.tokens.refreshToken);
  assert.ok(secondRow?.revoked_at, "logout-revoked tokens never qualify for the grace-window reissue");
});

// SHOULD-FIX — the grace window must be strictly ONE hop: a token issued
// BY the grace path must never itself be able to grant another grace pass.
// Without this, an attacker holding a stale-but-recently-superseded token
// and a legitimate client each replaying "the token right before whatever
// is currently live" can ping-pong indefinite reissues forever — each hop
// looks exactly like a legitimate "lost response" retry to the grace path,
// so the real theft/replay revoke-all never fires.
test("presenting a grace-issued token's predecessor-in-chain again within the window does NOT re-grace", async () => {
  const { service, repo } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");
  // An unrelated session that must only survive if the eventual response
  // here really is "revoke everything" (the real theft/replay path).
  const second = await service.login("a@b.c", "password123");

  // T0 -> T1 (a normal, client-initiated rotation).
  const first = await service.refresh(tokens.refreshToken);
  // The client never received T1 and retries with T0 — the grace path
  // fires, rotating T1 (the replacement) into T2 on the client's behalf.
  await service.refresh(tokens.refreshToken);

  // T1 ("first") is the grace-issued token's predecessor-in-chain: its own
  // revocation just now was performed BY the grace path, not by its
  // holder calling /auth/refresh directly. Replaying it again, still well
  // within the grace window, must NOT grant a further grace reissue.
  await assert.rejects(service.refresh(first.refreshToken), InvalidRefreshTokenError);

  // The real theft/replay response: every other session revoked too.
  const secondRow = findRowByToken(repo, second.tokens.refreshToken);
  assert.ok(secondRow?.revoked_at, "a re-graced chain must fall through to the full revoke-all response");
});

test("a grace-issued token cannot be graced after a later normal rotation", async () => {
  const { service, repo } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");
  const second = await service.login("a@b.c", "password123");

  await service.refresh(tokens.refreshToken);
  const graceIssued = await service.refresh(tokens.refreshToken);
  await service.refresh(graceIssued.refreshToken);

  await assert.rejects(service.refresh(graceIssued.refreshToken), InvalidRefreshTokenError);
  assert.ok(findRowByToken(repo, second.tokens.refreshToken)?.revoked_at);
});

test("concurrent refreshes of the same token both succeed without revoking unrelated sessions", async () => {
  const { service, repo } = makeService();
  const { tokens } = await service.signup("a@b.c", "andre", "password123");
  const second = await service.login("a@b.c", "password123");

  const [a, b] = await Promise.all([service.refresh(tokens.refreshToken), service.refresh(tokens.refreshToken)]);

  assert.ok(a.refreshToken);
  assert.ok(b.refreshToken);

  const secondRow = findRowByToken(repo, second.tokens.refreshToken);
  assert.equal(secondRow?.revoked_at, null, "a race between two refreshes of the SAME token must not look like theft to an unrelated session");
});

test("getAppearance is all null until something is saved, and setAppearance updates only the given fields", () => {
  const { service, repo } = makeService();
  const row = repo.createUser({ email: "t@example.test", username: "themer", passwordHash: null, googleId: null });
  assert.deepEqual(service.getAppearance(row.id), { theme: null, displayFont: null, textFont: null });
  service.setAppearance(row.id, { theme: "oxblood" });
  assert.deepEqual(service.getAppearance(row.id), { theme: "oxblood", displayFont: null, textFont: null });
  service.setAppearance(row.id, { displayFont: "righteous", textFont: "theme" });
  assert.deepEqual(service.getAppearance(row.id), { theme: "oxblood", displayFont: "righteous", textFont: "theme" });
});

test("getAppearance reads stored values this server no longer knows as the defaults", () => {
  const { service, repo } = makeService();
  const row = repo.createUser({ email: "old@example.test", username: "oldtheme", passwordHash: null, googleId: null });
  repo.rows.set(row.id, { ...row, theme: "vaporwave", display_font: "comic", text_font: "vt323" });
  assert.deepEqual(service.getAppearance(row.id), { theme: "system", displayFont: "theme", textFont: "theme" });
});

test("getAppearance is all null for an unknown user", () => {
  const { service } = makeService();
  assert.deepEqual(service.getAppearance("nobody"), { theme: null, displayFont: null, textFont: null });
});
