import type { QuizQuestionType } from "@scripta/shared";

export const QUIZ_TYPE_LABELS: Record<QuizQuestionType, string> = {
  cover_title: "Guess the title from a blurred cover",
  title_cover: "Guess the cover from the title",
  quote_title: "Guess the book from a quote",
  blurb_title: "Guess the book from its blurb",
  characters_title: "Guess the book from its characters"
};
