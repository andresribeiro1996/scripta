import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { UnusableAnswerError } from "../../domain/errors.js";
import { candidateLabel, createJevMatchClassifier } from "./jevWorkMatch.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(body: unknown): Array<RequestInit | undefined> {
  const seen: Array<RequestInit | undefined> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(init);
    return Response.json(body);
  }) as typeof fetch;
  return seen;
}

const input = {
  edition: { title: "Passeio ao Farol", author: "Virginia Woolf", originalTitle: "To the Lighthouse", publisher: "Relógio d'Água", description: "x".repeat(600) },
  candidates: [{ title: "Orlando", author: "Virginia Woolf", year: 1928 }, { title: "To the Lighthouse", author: "Virginia Woolf", year: null }]
};

test("asks one choice over the candidates plus none, with the spec's wording", async () => {
  const seen = stub({ model: "jev-1.13.0", answers: { work: { choice: "w2", confidence: 0.97 } } });
  assert.deepEqual(await createJevMatchClassifier("key", () => {}, async () => {})(input), { choice: 1, confidence: 0.97, model: "jev-1.13.0" });
  const body = JSON.parse(String(seen[0]?.body));
  assert.deepEqual(body.state.edition, { title: "Passeio ao Farol", author: "Virginia Woolf", original_title: "To the Lighthouse", publisher: "Relógio d'Água", description: "x".repeat(500) });
  assert.equal(body.questions.work.type, "choice");
  assert.ok(body.questions.work.instructions.startsWith("`edition` is a Portuguese-language edition of a book, possibly a translation."));
  assert.deepEqual(body.questions.work.criteria, {
    w1: "Orlando — Virginia Woolf (earliest edition 1928)",
    w2: "To the Lighthouse — Virginia Woolf",
    none: "None of the listed works: the edition is a different book from all of them"
  });
});

test("none is no choice, and an unknown option is unusable", async () => {
  stub({ model: "jev-1.13.0", answers: { work: { choice: "none", confidence: 0.81 } } });
  assert.deepEqual(await createJevMatchClassifier("key", () => {}, async () => {})(input), { choice: null, confidence: 0.81, model: "jev-1.13.0" });
  stub({ model: "jev-1.13.0", answers: { work: { choice: "w9", confidence: 0.5 } } });
  await assert.rejects(createJevMatchClassifier("key", () => {}, async () => {})(input), UnusableAnswerError);
});

test("a candidate label leaves out an unknown year", () => {
  assert.equal(candidateLabel({ title: "Solaris", author: "Stanisław Lem", year: null }), "Solaris — Stanisław Lem");
});
