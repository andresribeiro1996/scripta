import assert from "node:assert/strict";
import fastifyMultipart from "@fastify/multipart";
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
const { FileTooLargeError } = await import("./domain/errors.js");

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

test("gallery errors come back in Portuguese for a Portuguese request and stay English otherwise", async () => {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(fastifyMultipart);
  const service = { uploadImage: async () => { throw new FileTooLargeError(5 * 1024 * 1024); }, deleteImage: async () => false };
  await app.register(buildGalleryRoutes(service as never, publicUrlFor));
  const auth = { authorization: "Bearer u1" };
  const boundary = "gallery";
  const upload = (headers: Record<string, string>) => app.inject({
    method: "POST",
    url: "/gallery",
    headers: { ...auth, ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nx\r\n--${boundary}--\r\n`
  });
  const portuguese = await upload({ "accept-language": "pt-PT" });
  assert.equal(portuguese.statusCode, 413);
  assert.deepEqual(portuguese.json(), { error: "Os ficheiros não podem ter mais de 5 MB." });
  assert.deepEqual((await upload({})).json(), { error: "Files can't be larger than 5 MB." });
  const missing = await app.inject({ method: "DELETE", url: `/gallery/${id}`, headers: { ...auth, "accept-language": "pt-PT" } });
  assert.deepEqual(missing.json(), { error: "Não existe nenhuma imagem com esse identificador na sua galeria." });
  await app.close();
});
