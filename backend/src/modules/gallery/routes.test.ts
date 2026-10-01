import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "gallery-routes-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { buildGalleryRoutes } = await import("./routes.js");

const id = "123e4567-e89b-42d3-a456-426614174000";
const publicUrlFor = (imageId: string) => `https://images.test/gallery/${imageId}.webp`;

async function get(url: string) {
  const app = Fastify();
  await app.register(buildGalleryRoutes({} as never, publicUrlFor));
  const res = await app.inject({ url });
  await app.close();
  return res;
}

test("the old file url redirects to the public image url", async () => {
  const res = await get(`/gallery/${id}/file`);
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, publicUrlFor(id));
});

test("a file url whose id is not a uuid answers 400", async () => {
  const res = await get("/gallery/not-a-uuid/file");
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers.location, undefined);
});
