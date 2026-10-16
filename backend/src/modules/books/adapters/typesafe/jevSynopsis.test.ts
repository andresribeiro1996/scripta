import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { UnusableAnswerError } from "../../domain/errors.js";
import { createJevSynopsisClassifier, SYNOPSIS_TEXT_LIMIT } from "./jevSynopsis.js";

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

const answer = (usable: number, kind: string) => () => Response.json({ model: "jev-1.13.0", answers: { usable: { type: "noul", noul: usable }, kind: { type: "choice", choice: kind, confidence: 0.9, probabilities: {} } }, usage: { input_tokens: 400, output_tokens: 20 } });
const noSleep = async () => {};
const noSpend = () => {};
const input = { title: "Os Anões", author: "Harold Pinter", text: "Uma peça sobre três amigos em Londres." };

test("asks one yes/no and one kind choice about the stored text", async () => {
  const seen = stub([answer(0.12, "praise")]);
  assert.deepEqual(await createJevSynopsisClassifier("key", noSpend, noSleep)(input), { usable: 0.12, kind: "praise", model: "jev-1.13.0" });
  assert.equal(seen[0]!.url, "https://api.typesafe.ai/v1/systemone");
  const body = JSON.parse(String(seen[0]!.init?.body));
  assert.equal(body.model, "jev-1.13.0");
  assert.deepEqual(body.state, { book: { title: "Os Anões", author: "Harold Pinter" }, text: "Uma peça sobre três amigos em Londres." });
  assert.deepEqual(Object.keys(body.questions), ["usable", "kind"]);
  assert.equal(body.questions.usable.type, "noul");
  assert.deepEqual(Object.keys(body.questions.usable.criteria), ["true", "false"]);
  assert.equal(body.questions.kind.type, "choice");
  assert.deepEqual(Object.keys(body.questions.kind.criteria), ["synopsis", "author_bio", "praise", "collection", "product", "contents", "other_book", "fragment"]);
});

test("the text is cut to 2,500 characters", async () => {
  const seen = stub([answer(0.9, "synopsis")]);
  await createJevSynopsisClassifier("key", noSpend, noSleep)({ ...input, text: "x".repeat(3000) });
  assert.equal(JSON.parse(String(seen[0]!.init?.body)).state.text.length, SYNOPSIS_TEXT_LIMIT);
});

test("an unknown kind or a missing probability is an unusable answer", async () => {
  stub([() => Response.json({ model: "jev-1.13.0", answers: { usable: { noul: 0.4 }, kind: { choice: "novel" } } })]);
  await assert.rejects(createJevSynopsisClassifier("key", noSpend, noSleep)(input), UnusableAnswerError);
  stub([() => Response.json({ model: "jev-1.13.0", answers: { kind: { choice: "praise" } } })]);
  await assert.rejects(createJevSynopsisClassifier("key", noSpend, noSleep)(input), UnusableAnswerError);
});

test("every request, retries included, spends budget first", async () => {
  let spent = 0;
  stub([() => new Response("{}", { status: 429 }), answer(0.8, "synopsis")]);
  await createJevSynopsisClassifier("key", () => { spent += 1; }, noSleep)(input);
  assert.equal(spent, 2);
});
