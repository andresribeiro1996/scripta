import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";

const scratch = mkdtempSync(join(tmpdir(), "socials-plugin-test-"));
process.env.AUTH_DB_PATH ??= join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratch, "gallery.sqlite");
process.env.SOCIALS_DB_PATH = join(scratch, "socials.sqlite");
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.X_CLIENT_ID = "client";
process.env.X_CLIENT_SECRET = "secret";
process.env.X_CALLBACK_URL = "http://localhost/socials/x/callback";
process.env.SOCIALS_SUCCESS_REDIRECT_URL = "http://localhost/settings";

const { socialsPlugin } = await import("./plugin.js");

async function socialsApp() {
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(fastifyCookie);
  await app.register(socialsPlugin);
  return app;
}

async function failedCallback(app: Awaited<ReturnType<typeof socialsApp>>, headers: Record<string, string>) {
  const link = await app.inject({ method: "POST", url: "/socials/x/link-session", headers: { authorization: "Bearer x", "accept-language": "pt-PT" } });
  const { linkId } = link.json();
  const callback = await app.inject({ method: "GET", url: `/socials/x/callback?state=${linkId}&code=nope`, headers });
  assert.equal(callback.statusCode, 302);
  return new URL(callback.headers.location as string).searchParams.get("social_message");
}

test("a link session created under pt-PT answers a failed callback in Portuguese whatever the browser sends", async () => {
  const app = await socialsApp();
  assert.equal(await failedCallback(app, {}), "Não foi possível concluir a ligação a X.");
  assert.equal(await failedCallback(app, { "accept-language": "en-US" }), "Não foi possível concluir a ligação a X.");
  await app.close();
});

test("an unknown link session answers in English", async () => {
  const app = await socialsApp();
  const callback = await app.inject({ method: "GET", url: "/socials/x/callback?state=missing", headers: { "accept-language": "pt-PT" } });
  assert.equal(new URL(callback.headers.location as string).searchParams.get("social_message"), "This connection link expired — please try again.");
  await app.close();
});
