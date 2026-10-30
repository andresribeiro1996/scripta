import { useState } from "react";
import { SYNOPSIS_REVIEW_GROUPS, SYNOPSIS_REVIEW_HEADINGS, synopsisEvidenceLabel, type SynopsisDecision, type SynopsisReview, type SynopsisReviewItem } from "@scripta/shared";
import { BUTTON_SECONDARY } from "./page/buttonClasses";
import { LIST_PANEL, LIST_ROW, PANEL_HEADING } from "./page/surfaceClasses";

function SynopsisReviewRow({ item, onDecide }: { item: SynopsisReviewItem; onDecide: (hash: string, decision: SynopsisDecision) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = (decision: SynopsisDecision) => {
    setBusy(true);
    setError(null);
    onDecide(item.hash, decision).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That didn't save.");
      setBusy(false);
    });
  };
  const carriers = `${item.editions} ${item.editions === 1 ? "edition" : "editions"}${item.works > 1 ? ` · ${item.works} works` : ""}`;
  return (
    <li className={`${LIST_ROW} items-start!`}>
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" /> : <div className="h-24 w-16 shrink-0 rounded bg-(--color-surface-hover)" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-(--color-text-dim)">{item.author}</p>
        <p className="mt-1 text-xs text-(--color-text-dim)">{`${synopsisEvidenceLabel(item)} · ${item.source ?? "unknown source"} · ${carriers} · ${item.holders} ${item.holders === 1 ? "library" : "libraries"}${item.finished ? " · finished" : ""}`}</p>
        <p className="mt-2 whitespace-pre-line text-sm">{item.text}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => decide("keep")} className={BUTTON_SECONDARY}>
            Keep
          </button>
          <button type="button" disabled={busy} onClick={() => decide("hide")} className={BUTTON_SECONDARY}>
            Hide
          </button>
        </div>
        {error ? <p role="alert" className="mt-1 text-sm text-(--color-danger)">{error}</p> : null}
      </div>
    </li>
  );
}

export function SynopsisReviewList({ review, onDecide }: { review: SynopsisReview; onDecide: (hash: string, decision: SynopsisDecision) => Promise<void> }) {
  return (
    <div>
      <p className="text-sm text-(--color-text-dim)">{`${review.total} to review${review.total > review.items.length ? `, showing ${review.items.length}` : ""}`}</p>
      {SYNOPSIS_REVIEW_GROUPS.map((group) => {
        const items = review.items.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="mt-6">
            <h2 className={`${PANEL_HEADING} mb-2`}>{`${SYNOPSIS_REVIEW_HEADINGS[group]} (${items.length})`}</h2>
            <ul className={LIST_PANEL}>
              {items.map((item) => (
                <SynopsisReviewRow key={item.hash} item={item} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
