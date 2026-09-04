import type { TournamentSummary } from "../../api/arena";

/** A tournament's stage, as a coloured pill.
 *
 *  Status used to render as the raw enum in dim grey — "seeding",
 *  "active", "completed" all identical at a glance, so telling which of
 *  your tournaments still needed seeding meant reading every row. The
 *  three now differ in colour AND wording:
 *
 *    seeding    neutral   not started; still needs books
 *    active     accent    running, and the only one that wants anything
 *    completed  success   finished
 *
 *  Colour is reinforcement, never the only channel — each pill says what
 *  it is in words, so this reads the same to a colourblind viewer, in
 *  greyscale, or read aloud. That matters more here than usual because
 *  accent-orange and the new success-green are the app's two "something
 *  happened" colours and are the pair most likely to be confused.
 *
 *  An active tournament shows its round when one is passed, since "Round
 *  3" says everything "Active" does and more. */
export function TournamentStatusBadge({
  status,
  round,
  className = ""
}: {
  status: TournamentSummary["status"];
  round?: number;
  className?: string;
}) {
  const styles: Record<TournamentSummary["status"], string> = {
    seeding: "border-(--color-border) bg-(--color-surface) text-(--color-text-dim)",
    active: "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)",
    completed: "border-(--color-success) bg-(--color-success-soft) text-(--color-success)"
  };
  const labels: Record<TournamentSummary["status"], string> = {
    seeding: "Seeding",
    active: round ? `Round ${round}` : "Active",
    completed: "Completed"
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles[status]} ${className}`}
    >
      {labels[status]}
    </span>
  );
}
