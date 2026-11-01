import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { catalogMismatches } from "@scripta/shared/i18n";
import { z } from "zod";

const scratch = mkdtempSync(join(tmpdir(), "i18n-test-"));
process.env.AUTH_DB_PATH ??= join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH ??= join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);

const { en } = await import("./messages/en.js");
const { ptPT } = await import("./messages/pt-PT.js");
const { LocalizedError, localeOf, t, validationMessage } = await import("./index.js");
const { handleError } = await import("../app.js");

function requestWith(acceptLanguage?: string) {
  return { headers: acceptLanguage === undefined ? {} : { "accept-language": acceptLanguage } } as Parameters<typeof localeOf>[0];
}

function failure(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const parsed = schema.safeParse(value);
  assert.equal(parsed.success, false);
  return (parsed as { error: z.ZodError }).error;
}

test("the backend catalogs have no mismatches", () => {
  assert.deepEqual(catalogMismatches(en, ptPT), []);
});

test("localeOf reads the first Accept-Language tag", () => {
  assert.equal(localeOf(requestWith()), "en");
  assert.equal(localeOf(requestWith("pt-BR,en;q=0.5")), "pt-PT");
  assert.equal(localeOf(requestWith("en-PT")), "en");
});

test("t keeps English as it was and translates for pt-PT", () => {
  assert.equal(t("en", "common.internalError"), "Internal server error");
  assert.equal(t("pt-PT", "common.internalError"), "Erro interno do servidor");
});

test("LocalizedError carries the key and an English message", () => {
  const error = new LocalizedError("common.invalidRequest");
  assert.equal(error.key, "common.invalidRequest");
  assert.equal(error.message, "Invalid request.");
});

test("validationMessage translates zod defaults for pt-PT and leaves English alone", () => {
  const error = failure(z.object({ name: z.string() }), { name: 1 });
  assert.equal(validationMessage("en", error), "Expected string, received number");
  assert.equal(validationMessage("pt-PT", error), "Pedido inválido.");
});

test("validationMessage translates a catalog key used as a zod message", () => {
  const error = failure(z.string().min(3, "common.requestFailed"), "a");
  assert.equal(validationMessage("pt-PT", error), "Não foi possível concluir o pedido.");
  assert.equal(validationMessage("en", error), "Request failed.");
});

test("validationMessage falls back when there are no issues", () => {
  assert.equal(validationMessage("en", new z.ZodError([])), "Invalid request.");
  assert.equal(validationMessage("pt-PT", new z.ZodError([])), "Pedido inválido.");
});

async function inject(headers: Record<string, string>) {
  const app = Fastify();
  app.setErrorHandler(handleError);
  app.post("/echo", async () => ({ ok: true }));
  app.get("/boom", async () => {
    throw new Error("SQLITE_CONSTRAINT");
  });
  const bad = await app.inject({ method: "POST", url: "/echo", headers: { "content-type": "application/json", ...headers }, payload: "{" });
  const boom = await app.inject({ method: "GET", url: "/boom", headers });
  await app.close();
  return { bad, boom };
}

test("bad JSON keeps the default 4xx shape in English", async () => {
  const { bad, boom } = await inject({});
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().statusCode, 400);
  assert.equal(bad.json().error, "Bad Request");
  assert.equal(typeof bad.json().message, "string");
  assert.deepEqual(boom.json(), { error: "Internal server error" });
});

test("bad JSON returns a Portuguese error for pt-PT", async () => {
  const { bad, boom } = await inject({ "accept-language": "pt-PT" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().statusCode, 400);
  assert.equal(bad.json().error, "Não foi possível concluir o pedido.");
  assert.deepEqual(boom.json(), { error: "Erro interno do servidor" });
});

test("a 429 keeps its English message because the clients parse it", async () => {
  const app = Fastify();
  app.setErrorHandler(handleError);
  app.get("/limited", async () => {
    throw Object.assign(new Error("Rate limit exceeded, retry in 5 minutes"), { statusCode: 429 });
  });
  const response = await app.inject({ method: "GET", url: "/limited", headers: { "accept-language": "pt-PT" } });
  await app.close();
  assert.equal(response.statusCode, 429);
  assert.equal(response.json().message, "Rate limit exceeded, retry in 5 minutes");
});
