import { UnusableAnswerError } from "../../domain/errors.js";
import { SYNOPSIS_KINDS, type SynopsisKind } from "../../domain/synopsis.js";
import type { Spend } from "../../typesafe.js";
import { askJev, realSleep, type Sleep } from "./jevRequest.js";

export const SYNOPSIS_TEXT_LIMIT = 2500;

export type SynopsisInput = { title: string; author: string; text: string };
export type SynopsisAnswer = { usable: number; kind: SynopsisKind; model: string };
export type ClassifySynopsis = (input: SynopsisInput) => Promise<SynopsisAnswer>;

const QUESTIONS = {
  usable: {
    type: "noul",
    instructions: "Is `text` a description of the content of the book in `book`: what the book is about (its story, subject or argument)? Answer yes when the text describes this book's content, even if it also mentions the author or awards. Answer no when the text is mainly something else.",
    criteria: {
      true: "The text describes what this book is about, so it can serve as the book's synopsis.",
      false: "The text is mainly an author biography, praise quotes or reviews, a description of a series, collection or publisher, product or shop information, a table of contents, a description of a different book, or too short or fragmentary to say what the book is about."
    }
  },
  kind: {
    type: "choice",
    instructions: "What is `text` mainly? `text` was stored as the description of the book in `book`.",
    criteria: {
      synopsis: "A description of what this book is about: story, subject or argument",
      author_bio: "Mainly a biography of the author",
      praise: "Mainly praise, review quotes, awards or sales claims",
      collection: "Mainly about a series, a collection or the publisher rather than this book",
      product: "Product or shop information: format, materials, a non-book item, prices or shipping",
      contents: "A table of contents or list of included pieces",
      other_book: "A description of a different book",
      fragment: "Too short or fragmentary to tell what the book is about"
    }
  }
};

const KINDS = new Set<string>(SYNOPSIS_KINDS);

function answerOf(body: unknown): SynopsisAnswer {
  const answers = (body as { answers?: { usable?: { noul?: unknown }; kind?: { choice?: unknown } } } | null)?.answers;
  const model = (body as { model?: unknown } | null)?.model;
  const usable = answers?.usable?.noul;
  const kind = answers?.kind?.choice;
  if (typeof usable !== "number" || typeof kind !== "string" || !KINDS.has(kind) || typeof model !== "string") throw new UnusableAnswerError("typesafe", "unexpected answer");
  return { usable, kind: kind as SynopsisKind, model };
}

export function createJevSynopsisClassifier(apiKey: string, spend: Spend, sleep: Sleep = realSleep): ClassifySynopsis {
  return async (input) => answerOf(await askJev(apiKey, spend, sleep, { book: { title: input.title, author: input.author }, text: input.text.slice(0, SYNOPSIS_TEXT_LIMIT) }, QUESTIONS));
}
