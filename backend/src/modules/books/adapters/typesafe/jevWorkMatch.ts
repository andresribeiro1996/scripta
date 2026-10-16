import { UnusableAnswerError } from "../../domain/errors.js";
import type { Spend } from "../../typesafe.js";
import { askJev, realSleep, type Sleep } from "./jevRequest.js";

export const MATCH_DESCRIPTION_LIMIT = 500;

export type MatchInput = {
  edition: { title: string; author: string; originalTitle: string | null; publisher: string | null; description: string | null };
  candidates: Array<{ title: string; author: string; year: number | null }>;
};
export type MatchAnswer = { choice: number | null; confidence: number; model: string };
export type ClassifyMatch = (input: MatchInput) => Promise<MatchAnswer>;

const INSTRUCTIONS = "`edition` is a Portuguese-language edition of a book, possibly a translation. Which of the listed works is the work this edition is an edition of? Titles of the works may be in the original language. Pick none when no listed work is the same book.";
const NONE = "None of the listed works: the edition is a different book from all of them";

export function candidateLabel(candidate: { title: string; author: string; year: number | null }): string {
  return `${candidate.title} — ${candidate.author}${candidate.year !== null ? ` (earliest edition ${candidate.year})` : ""}`;
}

function answerOf(body: unknown, count: number): MatchAnswer {
  const answer = (body as { answers?: { work?: { choice?: unknown; confidence?: unknown } } } | null)?.answers?.work;
  const model = (body as { model?: unknown } | null)?.model;
  const index = typeof answer?.choice === "string" && /^w\d+$/.test(answer.choice) ? Number(answer.choice.slice(1)) - 1 : null;
  const known = answer?.choice === "none" || (index !== null && index >= 0 && index < count);
  if (!known || typeof answer?.confidence !== "number" || typeof model !== "string") throw new UnusableAnswerError("typesafe", "unexpected answer");
  return { choice: answer.choice === "none" ? null : index, confidence: answer.confidence, model };
}

export function createJevMatchClassifier(apiKey: string, spend: Spend, sleep: Sleep = realSleep): ClassifyMatch {
  return async (input) => {
    const criteria = Object.fromEntries([...input.candidates.map((candidate, index) => [`w${index + 1}`, candidateLabel(candidate)]), ["none", NONE]]);
    const edition = {
      title: input.edition.title,
      author: input.edition.author,
      ...(input.edition.originalTitle ? { original_title: input.edition.originalTitle } : {}),
      publisher: input.edition.publisher,
      description: input.edition.description?.slice(0, MATCH_DESCRIPTION_LIMIT) ?? null
    };
    return answerOf(await askJev(apiKey, spend, sleep, { edition }, { work: { type: "choice", instructions: INSTRUCTIONS, criteria } }), input.candidates.length);
  };
}
