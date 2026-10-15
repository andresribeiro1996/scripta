import { useState } from "react";
import { SYNOPSIS_REVIEW_GROUPS, SYNOPSIS_REVIEW_HEADINGS, synopsisEvidenceLabel, type SynopsisDecision, type SynopsisReview, type SynopsisReviewItem } from "@scripta/shared";

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
    <li className="flex gap-3 border-b border-(--color-border) py-4">
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" /> : <div className="h-24 w-16 shrink-0 rounded bg-(--color-surface-hover)" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-(--color-text-dim)">{item.author}</p>
        <p className="mt-1 text-xs text-(--color-text-dim)">{`${synopsisEvidenceLabel(item)} · ${item.source ?? "unknown source"} · ${carriers} · ${item.holders} ${item.holders === 1 ? "library" : "libraries"}${item.finished ? " · finished" : ""}`}</p>
        <p className="mt-2 whitespace-pre-line text-sm">{item.text}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => decide("keep")} className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-(--color-on-accent) disabled:opacity-50">
            Keep
          </button>
          <button type="button" disabled={busy} onClick={() => decide("hide")} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
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
            <h2 className="text-lg font-bold">{`${SYNOPSIS_REVIEW_HEADINGS[group]} (${items.length})`}</h2>
            <ul>
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
