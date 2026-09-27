import type { Quiz } from "../../api/quizzes";

/** A quiz's stage, as a coloured pill — the quiz counterpart to
 *  TournamentStatusBadge, same pill shape and same "colour is
 *  reinforcement, the words carry it" rule:
 *
 *    draft   neutral   not started; still needs books/quotes
 *    open    info      running with nothing asked of the owner
 *    closed  success   finished
 *
 *  Open takes `info`, not TournamentStatusBadge's `accent`, on purpose:
 *  accent there marks the one stage that wants something from the owner
 *  (seeding, settling, tie-breaks); an open quiz wants nothing — the token
 *  table's own description of `info` ("running with nothing asked of you").
 *  The owner's action button for the open state lives in the editor. */
export function QuizStatusBadge({ status, className = "" }: { status: "draft" | "open" | "closed"; className?: string }) {
  const styles: Record<"draft" | "open" | "closed", string> = {
    draft: "border-(--color-border) bg-(--color-surface) text-(--color-text-dim)",
    open: "border-(--color-info) bg-(--color-info-soft) text-(--color-info)",
    closed: "border-(--color-success) bg-(--color-success-soft) text-(--color-success)"
  };
  const labels: Record<"draft" | "open" | "closed", string> = {
    draft: "Draft",
    open: "Open",
    closed: "Closed"
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles[status]} ${className}`}
    >
      {labels[status]}
    </span>
  );
}

export function quizStatus(quiz: Quiz): "draft" | "open" | "closed" {
  return quiz.voteCode === null ? "draft" : quiz.playOpen ? "open" : "closed";
}
