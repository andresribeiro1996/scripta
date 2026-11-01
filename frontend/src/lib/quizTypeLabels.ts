import type { QuizQuestionType } from "@scripta/shared";
import type { WebMessages } from "../i18n";

export const QUIZ_TYPE_LABEL_KEYS: Record<QuizQuestionType, Extract<keyof WebMessages, `quizzes.type${string}`>> = {
  cover_title: "quizzes.typeCoverTitle",
  title_cover: "quizzes.typeTitleCover",
  quote_title: "quizzes.typeQuoteTitle",
  blurb_title: "quizzes.typeBlurbTitle",
  characters_title: "quizzes.typeCharactersTitle"
};
