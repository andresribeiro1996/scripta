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
import { AvatarDimensionsTooLargeError, AvatarTooLargeError, InvalidAvatarError } from "./domain/errors.js";
import type { AuthRepository, AvatarBlobStore } from "./domain/ports.js";
import type { RefreshTokenRow, UserRow } from "./domain/types.js";
import { createAuthService } from "./service.js";

function createInMemoryRepo(): AuthRepository & { rows: Map<string, UserRow> } {
  const rows = new Map<string, UserRow>();

  return {
    rows,
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
    insertRefreshToken() {
      return "token-id";
    },
    findRefreshTokenByHash(): RefreshTokenRow | undefined {
      return undefined;
    },
    revokeRefreshToken() {},
    revokeAllRefreshTokensForUser() {}
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
