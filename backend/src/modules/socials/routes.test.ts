import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import type { SocialsService } from "./service.js";

const scratch = mkdtempSync(join(tmpdir(), "socials-routes-test-"));
process.env.AUTH_DB_PATH ??= join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratch, "gallery.sqlite");
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);

const { SocialNotConnectedError, SocialPostRejectedError, BlueskyAuthError } = await import("./domain/errors.js");
const { buildSocialsRoutes } = await import("./routes.js");

async function socialsApp(overrides: Partial<SocialsService> = {}) {
  const service = {
    listStatuses: () => [],
    connectBluesky: async () => {},
    postToSocial: async () => ({ id: "1" }),
    disconnect: () => {},
    ...overrides
  } as unknown as SocialsService;
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(buildSocialsRoutes(service));
  return app;
}

const auth = { authorization: "Bearer x" };
const portuguese = { ...auth, "accept-language": "pt-PT" };

test("route messages stay English by default and turn Portuguese on request", async () => {
  const app = await socialsApp();
  const english = await app.inject({ method: "DELETE", url: "/socials/myspace", headers: auth });
  assert.equal(english.statusCode, 400);
  assert.deepEqual(english.json(), { error: "Unknown provider \"myspace\"." });
  const ptPT = await app.inject({ method: "DELETE", url: "/socials/myspace", headers: portuguese });
  assert.deepEqual(ptPT.json(), { error: "Fornecedor \"myspace\" desconhecido." });
  const link = await app.inject({ method: "POST", url: "/socials/bluesky/link-session", headers: portuguese });
  assert.deepEqual(link.json(), { error: "\"bluesky\" não é um fornecedor baseado em OAuth." });
  await app.close();
});

test("validation messages are translated and zod defaults fall back to the generic text", async () => {
  const app = await socialsApp();
  const english = await app.inject({ method: "POST", url: "/socials/bluesky/connect", headers: auth, payload: { handle: "", appPassword: "x" } });
  assert.deepEqual(english.json(), { error: "Handle is required." });
  const ptPT = await app.inject({ method: "POST", url: "/socials/bluesky/connect", headers: portuguese, payload: { handle: "", appPassword: "x" } });
  assert.deepEqual(ptPT.json(), { error: "O identificador é obrigatório." });
  const post = await app.inject({ method: "POST", url: "/socials/x/post", headers: portuguese, payload: { text: "" } });
  assert.deepEqual(post.json(), { error: "Pedido inválido." });
  await app.close();
});

test("domain errors are translated at the route", async () => {
  const app = await socialsApp({
    connectBluesky: async () => {
      throw new BlueskyAuthError("socials.blueskyRejected");
    },
    postToSocial: async (_userId: string, provider: string) => {
      throw provider === "x" ? new SocialNotConnectedError("X") : new SocialPostRejectedError("Threads", "HTTP 500");
    }
  } as Partial<SocialsService>);
  const connect = await app.inject({ method: "POST", url: "/socials/bluesky/connect", headers: portuguese, payload: { handle: "a.bsky.social", appPassword: "x" } });
  assert.equal(connect.statusCode, 401);
  assert.deepEqual(connect.json(), { error: "O Bluesky rejeitou essa combinação de identificador e palavra-passe de aplicação." });
  const notConnected = await app.inject({ method: "POST", url: "/socials/x/post", headers: portuguese, payload: { text: "hi" } });
  assert.equal(notConnected.statusCode, 409);
  assert.deepEqual(notConnected.json(), { error: "X não está ligado — ligue-o primeiro em Definições." });
  const rejected = await app.inject({ method: "POST", url: "/socials/threads/post", headers: portuguese, payload: { text: "hi" } });
  assert.equal(rejected.statusCode, 502);
  assert.deepEqual(rejected.json(), { error: "Threads rejeitou esta publicação (HTTP 500) — tente voltar a ligar Threads em Definições." });
  const english = await app.inject({ method: "POST", url: "/socials/threads/post", headers: auth, payload: { text: "hi" } });
  assert.deepEqual(english.json(), { error: "Threads rejected this post (HTTP 500) — try reconnecting Threads in Settings." });
  await app.close();
});
