import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";

const scratch = mkdtempSync(join(tmpdir(), "works-routes-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { buildWorkRoutes } = await import("./routes.js");
const { WorkResolutionError } = await import("../library/index.js");

function appWith(getPage: (id: string, viewerId: string | null) => unknown) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === "good" ? { id: "viewer", email: "v@example.test", username: "viewer", avatarId: null } : null));
  app.setErrorHandler((error, _request, reply) => (error instanceof WorkResolutionError ? reply.code(503).send({ error: error.message }) : reply.code(500).send({ error: "Internal server error" })));
  void app.register(buildWorkRoutes({ getPage } as never));
  return app;
}

test("an unknown id is a 404 with the agreed message", async () => {
  const app = appWith(() => undefined);
  const res = await app.inject({ url: "/works/nope" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "No book with that id." });
  await app.close();
});

test("the viewer is optional, and responses are never cached", async () => {
  const seen: Array<string | null> = [];
  const app = appWith((_id, viewerId) => { seen.push(viewerId); return { work: { id: "w" } }; });
  const anonymous = await app.inject({ url: "/works/w" });
  const signedIn = await app.inject({ url: "/works/w", headers: { authorization: "Bearer good" } });
  const badToken = await app.inject({ url: "/works/w", headers: { authorization: "Bearer bad" } });
  assert.deepEqual([anonymous.statusCode, signedIn.statusCode, badToken.statusCode], [200, 200, 200]);
  assert.deepEqual(seen, [null, "viewer", null]);
  assert.equal(signedIn.headers["cache-control"], "no-store");
  await app.close();
});

test("a catalog outage is a 503 and any other failure is a 500, never an empty page", async () => {
  const down = appWith(() => { throw new WorkResolutionError(new Error("disk")); });
  assert.equal((await down.inject({ url: "/works/w" })).statusCode, 503);
  await down.close();
  const broken = appWith(() => { throw new Error("readers query failed"); });
  assert.equal((await broken.inject({ url: "/works/w" })).statusCode, 500);
  await broken.close();
});
