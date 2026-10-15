import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError, UnusableAnswerError } from "../../domain/errors.js";
import { TypesafeBudgetSpentError } from "../../typesafe.js";
import { createJevGenreClassifier, JEV_MODEL } from "./jevGenres.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = { url: string; init?: RequestInit };
function stub(responses: Array<() => Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return responses[Math.min(seen.length, responses.length) - 1]!();
  }) as typeof fetch;
  return seen;
}

const answer = (choice: string, confidence = 0.9) => () => Response.json({ model: "jev-1.13.0", answers: { genre: { type: "choice", choice, confidence, probabilities: {} } }, usage: { input_tokens: 300, output_tokens: 20 } });
const status = (code: number) => () => new Response("{}", { status: code });
const noSleep = async () => {};
const noSpend = () => {};
const book = { title: "Os Anões", author: "Harold Pinter", editionLanguages: ["pt-PT"], publishers: [], synopsis: null };

test("asks the pinned model one genre Choice about the book's own fields", async () => {
  const seen = stub([answer("literary_fiction", 0.82)]);
  assert.deepEqual(await createJevGenreClassifier("key", noSpend, noSleep)(book), { genre: "Literary Fiction", confidence: 0.82, model: "jev-1.13.0" });
  assert.equal(seen[0]!.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(seen[0]!.init?.method, "POST");
  assert.equal(new Headers(seen[0]!.init?.headers).get("authorization"), "Bearer key");
  const body = JSON.parse(String(seen[0]!.init?.body));
  assert.equal(body.model, JEV_MODEL);
  assert.deepEqual(body.state, { book: { title: "Os Anões", author: "Harold Pinter", edition_languages: ["pt-PT"] } });
  assert.deepEqual(Object.keys(body.questions), ["genre"]);
  assert.equal(body.questions.genre.type, "choice");
  assert.equal(Object.keys(body.questions.genre.criteria).length, 27);
  assert.ok(body.questions.genre.criteria.none);
});

test("none means no genre", async () => {
  stub([answer("none", 0.95)]);
  assert.deepEqual(await createJevGenreClassifier("key", noSpend, noSleep)(book), { genre: null, confidence: 0.95, model: "jev-1.13.0" });
});

test("busy answers are retried, then the answer is used", async () => {
  const seen = stub([status(429), status(529), answer("poetry")]);
  assert.equal((await createJevGenreClassifier("key", noSpend, noSleep)(book)).genre, "Poetry");
  assert.equal(seen.length, 3);
});

test("a service that stays busy fails after the retries", async () => {
  const seen = stub([status(529)]);
  await assert.rejects(createJevGenreClassifier("key", noSpend, noSleep)(book), (error: unknown) => error instanceof SourceUnavailableError && error.status === 529);
  assert.equal(seen.length, 5);
});

test("a rejected key or request fails at once with its status", async () => {
  for (const code of [401, 422]) {
    const seen = stub([status(code)]);
    await assert.rejects(createJevGenreClassifier("key", noSpend, noSleep)(book), (error: unknown) => error instanceof SourceUnavailableError && error.status === code);
    assert.equal(seen.length, 1);
  }
});

test("an option the adapter doesn't know, or a body that isn't JSON, is an unusable answer", async () => {
  stub([answer("novel")]);
  await assert.rejects(createJevGenreClassifier("key", noSpend, noSleep)(book), (error: unknown) => error instanceof UnusableAnswerError && error.detail === "unexpected answer");
  stub([() => new Response("not json", { status: 200 })]);
  await assert.rejects(createJevGenreClassifier("key", noSpend, noSleep)(book), (error: unknown) => error instanceof UnusableAnswerError && error.detail === "invalid JSON");
});

test("every request spends budget first, retries included, and a spent budget makes no request", async () => {
  const seen = stub([status(429), answer("poetry")]);
  let spent = 0;
  await createJevGenreClassifier("key", () => { spent += 1; }, noSleep)(book);
  assert.equal(spent, 2);
  assert.equal(seen.length, 2);
  const none = stub([answer("poetry")]);
  await assert.rejects(createJevGenreClassifier("key", () => { throw new TypesafeBudgetSpentError("genres"); }, noSleep)(book), TypesafeBudgetSpentError);
  assert.equal(none.length, 0);
});

test("a body that fails mid-read is an outage", async () => {
  stub([() => new Response(new ReadableStream({ pull(controller) { controller.error(new TypeError("terminated")); } }), { status: 200 })]);
  await assert.rejects(createJevGenreClassifier("key", noSpend, noSleep)(book), (error: unknown) => error instanceof SourceUnavailableError && /terminated/.test(error.message));
});
