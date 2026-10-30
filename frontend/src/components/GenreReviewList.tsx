import { useState } from "react";
import { BOOK_GENRES, GENRE_REVIEW_GROUPS, GENRE_REVIEW_HEADINGS, genreEvidenceLabel, type GenreReview, type GenreReviewAction, type GenreReviewItem } from "@scripta/shared";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, chipClass } from "./page/buttonClasses";
import { LIST_PANEL, LIST_ROW, PANEL_HEADING } from "./page/surfaceClasses";

const MAX_GENRES = 3;

type Decide = (workId: string, action: GenreReviewAction) => Promise<void>;

function preselected(item: GenreReviewItem): string[] {
  return item.evidence.group === "unsure" || item.evidence.group === "possible" ? [item.evidence.genre] : [];
}

export async function submitDecision(onDecide: Decide, workId: string, action: GenreReviewAction): Promise<string | null> {
  try {
    await onDecide(workId, action);
    return null;
  } catch (reason) {
    return reason instanceof Error ? reason.message : "That didn't save.";
  }
}

export function GenreReviewRowView({
  item,
  picked,
  busy,
  error,
  onToggle,
  onDecide
}: {
  item: GenreReviewItem;
  picked: string[];
  busy: boolean;
  error: string | null;
  onToggle: (genre: string) => void;
  onDecide: (action: GenreReviewAction) => void;
}) {
  return (
    <li className={`${LIST_ROW} items-start!`}>
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" /> : <div className="h-24 w-16 shrink-0 rounded bg-(--color-surface-hover)" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-(--color-text-dim)">{item.author}</p>
        <p className="mt-1 text-xs text-(--color-text-dim)">{`${genreEvidenceLabel(item.evidence)} · ${item.holders} ${item.holders === 1 ? "library" : "libraries"}${item.finished ? " · finished" : ""}`}</p>
        {item.synopsis ? <p className="mt-1 line-clamp-3 text-sm">{item.synopsis}</p> : null}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {BOOK_GENRES.map((genre) => (
            <li key={genre}>
              <button
                type="button"
                aria-pressed={picked.includes(genre)}
                onClick={() => onToggle(genre)}
                className={chipClass(picked.includes(genre))}
              >
                {genre}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy || picked.length === 0} onClick={() => onDecide({ genres: picked })} className={BUTTON_PRIMARY}>
            Save
          </button>
          <button type="button" disabled={busy} onClick={() => onDecide({ genres: [] })} className={BUTTON_SECONDARY}>
            No genre
          </button>
          {item.evidence.group === "rejected" ? (
            <button type="button" disabled={busy} onClick={() => onDecide({ retry: true })} className={BUTTON_SECONDARY}>
              Retry
            </button>
          ) : null}
        </div>
        {error ? <p role="alert" className="mt-1 text-sm text-(--color-danger)">{error}</p> : null}
      </div>
    </li>
  );
}

function GenreReviewRow({ item, onDecide }: { item: GenreReviewItem; onDecide: Decide }) {
  const [picked, setPicked] = useState<string[]>(() => preselected(item));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = (action: GenreReviewAction) => {
    setBusy(true);
    setError(null);
    void submitDecision(onDecide, item.workId, action).then((message) => {
      if (message === null) return;
      setError(message);
      setBusy(false);
    });
  };
  const toggle = (genre: string) =>
    setPicked((current) => (current.includes(genre) ? current.filter((value) => value !== genre) : current.length < MAX_GENRES ? [...current, genre] : current));
  return <GenreReviewRowView item={item} picked={picked} busy={busy} error={error} onToggle={toggle} onDecide={decide} />;
}

export function GenreReviewList({ review, onDecide }: { review: GenreReview; onDecide: Decide }) {
  return (
    <div>
      <p className="text-sm text-(--color-text-dim)">{`${review.total} to review${review.total > review.items.length ? `, showing ${review.items.length}` : ""}`}</p>
      {GENRE_REVIEW_GROUPS.map((group) => {
        const items = review.items.filter((item) => item.evidence.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="mt-6">
            <h2 className={`${PANEL_HEADING} mb-2`}>{`${GENRE_REVIEW_HEADINGS[group]} (${items.length})`}</h2>
            <ul className={LIST_PANEL}>
              {items.map((item) => (
                <GenreReviewRow key={item.workId} item={item} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
