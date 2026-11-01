import type { Locale } from "@scripta/shared/i18n";
import type { QuizQuestionType } from "@scripta/shared";
import { translatorFor, type MessageKey } from "../../i18n";

const TYPE_LABEL_KEYS: Record<QuizQuestionType, Extract<MessageKey, `quizzes.type${string}`>> = {
  cover_title: "quizzes.typeCoverTitle",
  title_cover: "quizzes.typeTitleCover",
  quote_title: "quizzes.typeQuoteTitle",
  blurb_title: "quizzes.typeBlurbTitle",
  characters_title: "quizzes.typeCharactersTitle",
};

export function quizTypeLabel(type: QuizQuestionType, locale: Locale): string {
  return translatorFor(locale)(TYPE_LABEL_KEYS[type]);
}
