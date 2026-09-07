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
process.env.JWT_ACCESS_SECRET ??= "a".repeat(40);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(40);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH ??= join(scratchDir, "gallery-files");

const { createAuthService, REFRESH_ROTATION_GRACE_MS } = await import("./service.js");

function createInMemoryRepo(): AuthRepository & { rows: Map<string, UserRow>; refreshTokens: Map<string, RefreshTokenRow> } {
  const rows = new Map<string, UserRow>();
  const refreshTokens = new Map<string, RefreshTokenRow>();
  let nextRefreshTokenId = 1;

  return {
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
    findUserIdByAvatarId(avatarId) {
      return [...rows.values()].find((row) => row.avatar_id === avatarId)?.id;
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
    rotateRefreshToken(id, replacedByTokenId) {
      const row = refreshTokens.get(id);
      if (row) {
        const now = new Date().toISOString();
        refreshTokens.set(id, { ...row, revoked_at: now, rotated_at: now, replaced_by: replacedByTokenId });
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
  const key = (userId: string, avatarId: string) => `${userId}/${avatarId}`;
  return {
    saved,
    save(userId, avatarId, bytes) {
      saved.set(key(userId, avatarId), bytes);
    },
    read(userId, avatarId) {
      return saved.get(key(userId, avatarId)) ?? null;
    },
    delete(userId, avatarId) {
      saved.delete(key(userId, avatarId));
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
  const stored = blobStore.saved.get(`${user.id}/${updated.avatarId}`);
  assert.ok(stored);
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);

  const file = service.getAvatarFile(updated.avatarId);
  assert.ok(file);
  assert.equal(file.mimeType, "image/webp");
  assert.equal(file.buffer, stored);
});

test("setAvatar replaces a previous avatar and deletes the old blob", async () => {
  const { service, repo, blobStore } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  const first = await service.setAvatar(user.id, await pngBuffer(100, 100));
  const second = await service.setAvatar(user.id, await pngBuffer(120, 90));

  assert.notEqual(first.avatarId, second.avatarId);
  assert.equal(repo.rows.get(user.id)?.avatar_id, second.avatarId);
  assert.equal(blobStore.saved.has(`${user.id}/${first.avatarId}`), false);
  assert.equal(service.getAvatarFile(first.avatarId!), null);
});

test("removeAvatar clears the column and deletes the blob", async () => {
  const { service, repo, blobStore } = makeService();
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  const { avatarId } = await service.setAvatar(user.id, await pngBuffer(100, 100));

  const removed = await service.removeAvatar(user.id);

  assert.equal(removed.avatarId, null);
  assert.equal(repo.rows.get(user.id)?.avatar_id, null);
  assert.equal(blobStore.saved.has(`${user.id}/${avatarId}`), false);
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

test("getAvatarFile with an unknown id returns null", () => {
  const { service } = makeService();
  assert.equal(service.getAvatarFile("00000000-0000-4000-8000-000000000000"), null);
});

test("avatars are per-account: one user's avatar id never resolves another's", async () => {
  const { service, repo } = makeService();
  const a = repo.createUser({ email: "a@b.c", username: "a", passwordHash: "x", googleId: null });
  repo.createUser({ email: "d@e.f", username: "d", passwordHash: "x", googleId: null });

  const { avatarId } = await service.setAvatar(a.id, await pngBuffer(100, 100));

  assert.ok(service.getAvatarFile(avatarId!));
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
