import type { BookGenre } from "@scripta/shared";
import { SourceUnavailableError } from "../../domain/errors.js";
import { readBody } from "../http/http.js";

export const JEV_MODEL = "jev-1.13.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;
const RETRIES = 4;

export type JevBook = { title: string; author: string; editionLanguages: string[]; publishers: string[]; synopsis: string | null };
export type GenreJudgment = { genre: BookGenre | null; confidence: number; model: string };
export type ClassifyGenre = (book: JevBook) => Promise<GenreJudgment>;

const OPTIONS: Array<[string, BookGenre | null, string]> = [
  ["fantasy", "Fantasy", "Fantasy: magic, invented worlds, mythical creatures."],
  ["science_fiction", "Science Fiction", "Science Fiction: speculative science or technology, space, the future, dystopias and utopias."],
  ["romance", "Romance", "Romance: a love story is the book's main thrust (romance novels, romantic comedies). Not for novels in general: in Portuguese 'romance' just means 'novel'."],
  ["mystery", "Mystery", "Mystery: detective or puzzle-solving crime fiction (Portuguese 'policial')."],
  ["thriller", "Thriller", "Thriller: suspense-driven plots with danger, chases or conspiracies."],
  ["horror", "Horror", "Horror: fiction meant to frighten, including gothic and supernatural terror."],
  ["crime", "Crime", "Crime: fiction centred on criminals and crimes, or true crime."],
  ["historical_fiction", "Historical Fiction", "Historical Fiction: novels set in a real historical period, often with real historical figures as characters, such as novels about kings and queens."],
  ["literary_fiction", "Literary Fiction", "Literary Fiction: literary novels and short stories that are neither genre fiction nor canonical classics."],
  ["classics", "Classics", "Classics: canonical works of world or Portuguese literature, mostly written before about 1960."],
  ["biography_memoir", "Biography & Memoir", "Biography & Memoir: the true story of a real person's life, including diaries, letters and autobiographies."],
  ["history", "History", "History: non-fiction about historical events or periods."],
  ["politics", "Politics", "Politics: non-fiction about politics, government, society, feminism, activism or political ideas."],
  ["philosophy", "Philosophy", "Philosophy: non-fiction philosophical essays and treatises."],
  ["psychology", "Psychology", "Psychology: non-fiction about the mind, mental health or behaviour."],
  ["science", "Science", "Science: non-fiction about the natural sciences."],
  ["technology", "Technology", "Technology: non-fiction about computing or technology."],
  ["business", "Business", "Business: economics, management, finance or entrepreneurship."],
  ["self_help", "Self-Help", "Self-Help: personal development and advice books."],
  ["poetry", "Poetry", "Poetry: collections of poems or verse."],
  ["religion", "Religion", "Religion: theology, spirituality or religious texts."],
  ["travel", "Travel", "Travel: travel writing and travel guides."],
  ["cooking", "Cooking", "Cooking: cookbooks and food writing."],
  ["young_adult", "Young Adult", "Young Adult: fiction written for teenagers."],
  ["childrens", "Children's", "Children's: books written for children."],
  ["comics", "Comics & Graphic Novels", "Comics & Graphic Novels: comics, manga or graphic novels."],
  ["none", null, "None: no genre above fits (for example pet care or art books), or the book cannot be identified from the information given."]
];
const INSTRUCTIONS = "Which genre best describes the book in `book`? Judge from its title, author and synopsis, and pick the single best fit.";
const CRITERIA = Object.fromEntries(OPTIONS.map(([id, , description]) => [id, description]));
const GENRE_BY_OPTION = new Map(OPTIONS.map(([id, genre]) => [id, genre]));

function stateOf(book: JevBook) {
  return {
    book: {
      title: book.title,
      author: book.author,
      ...(book.editionLanguages.length > 0 ? { edition_languages: book.editionLanguages } : {}),
      ...(book.publishers.length > 0 ? { publishers: book.publishers } : {}),
      ...(book.synopsis ? { synopsis: book.synopsis } : {})
    }
  };
}

function judgmentOf(body: unknown): GenreJudgment {
  const answer = (body as { answers?: { genre?: { choice?: unknown; confidence?: unknown } } } | null)?.answers?.genre;
  const model = (body as { model?: unknown } | null)?.model;
  if (typeof answer?.choice !== "string" || !GENRE_BY_OPTION.has(answer.choice) || typeof answer.confidence !== "number" || typeof model !== "string") {
    throw new SourceUnavailableError("typesafe", "unexpected answer");
  }
  return { genre: GENRE_BY_OPTION.get(answer.choice) ?? null, confidence: answer.confidence, model };
}

export function createJevGenreClassifier(apiKey: string, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): ClassifyGenre {
  return async (book) => {
    const body = JSON.stringify({ state: stateOf(book), model: JEV_MODEL, questions: { genre: { type: "choice", instructions: INSTRUCTIONS, criteria: CRITERIA } } });
    for (let attempt = 0; ; attempt++) {
      const response = await readBody("typesafe", () => fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) }));
      if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
        await response.body?.cancel();
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new SourceUnavailableError("typesafe", `HTTP ${response.status}`, { status: response.status });
      }
      let parsed: unknown;
      try {
        parsed = await readBody("typesafe", () => response.json());
      } catch (error) {
        if (error instanceof SyntaxError) throw new SourceUnavailableError("typesafe", "invalid JSON");
        throw error;
      }
      return judgmentOf(parsed);
    }
  };
}
