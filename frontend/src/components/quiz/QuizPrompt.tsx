import type { PublicQuizQuestion } from "@scripta/shared";
import { CoverImage } from "../BookCard";
import { useT } from "../../i18n";

export function QuizPrompt({ question }: { question: PublicQuizQuestion }) {
  const t = useT();
  if (question.type === "cover_title") {
    return (
      <div className="relative mx-auto h-56 w-40 overflow-hidden rounded-lg bg-(--color-border) blur-md">
        <CoverImage book={{ Title: t("quizzes.coverUnavailable"), _coverUrl: question.prompt }} alt={t("quizzes.whichBookIsThis")} />
      </div>
    );
  }
  if (question.type === "title_cover") {
    return <p className="text-center text-2xl font-bold">{question.prompt}</p>;
  }
  if (question.type === "characters_title") {
    return (
      <div className="text-center">
        <p className="text-sm text-(--color-text-dim)">{t("quizzes.whoIsInThisBook")}</p>
        <p className="mt-1 text-xl font-bold">{question.prompt}</p>
      </div>
    );
  }
  return <p className="text-center font-serif text-lg italic leading-relaxed">“{question.prompt}”</p>;
}
