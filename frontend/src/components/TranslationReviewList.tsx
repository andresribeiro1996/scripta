import { useState } from "react";
import { TRANSLATION_REVIEW_GROUPS, TRANSLATION_REVIEW_HEADINGS, translationEvidenceLabel, type TranslationReview, type TranslationReviewAction, type TranslationReviewItem } from "@scripta/shared";

function TranslationReviewRow({ item, onDecide }: { item: TranslationReviewItem; onDecide: (workId: string, action: TranslationReviewAction) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = (action: TranslationReviewAction) => {
    setBusy(true);
    setError(null);
    onDecide(item.workId, action).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That didn't save.");
      setBusy(false);
    });
  };
  const original = item.proposed;
  return (
    <li className="flex gap-3 border-b border-(--color-border) py-4">
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" /> : <div className="h-24 w-16 shrink-0 rounded bg-(--color-surface-hover)" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-(--color-text-dim)">{`${item.author}${item.originalTitle ? ` · original title: ${item.originalTitle}` : ""}`}</p>
        <p className="mt-1 text-sm">{`→ ${original.title} · ${original.author}${original.year !== null ? ` · ${original.year}` : ""} · ${original.editions} ${original.editions === 1 ? "edition" : "editions"}${original.languages.length > 0 ? ` (${original.languages.join(", ")})` : ""}`}</p>
        <p className="mt-1 text-xs text-(--color-text-dim)">{`${translationEvidenceLabel(item)} · ${item.holders} ${item.holders === 1 ? "library" : "libraries"}${item.finished ? " · finished" : ""}`}</p>
        {item.synopsis ? <p className="mt-1 line-clamp-3 text-sm">{item.synopsis}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {item.group === "possible" ? (
            <button type="button" disabled={busy} onClick={() => decide({ merge: original.workId })} className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-(--color-on-accent) disabled:opacity-50">
              Merge
            </button>
          ) : null}
          {item.group === "merged" ? (
            <button type="button" disabled={busy} onClick={() => decide({ undo: true })} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
              Undo
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => decide({ reject: true })} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
              Not a translation
            </button>
          )}
        </div>
        {error ? <p role="alert" className="mt-1 text-sm text-(--color-danger)">{error}</p> : null}
      </div>
    </li>
  );
}

export function TranslationReviewList({ review, onDecide }: { review: TranslationReview; onDecide: (workId: string, action: TranslationReviewAction) => Promise<void> }) {
  return (
    <div>
      <p className="text-sm text-(--color-text-dim)">{`${review.total} to review${review.total > review.items.length ? `, showing ${review.items.length}` : ""}`}</p>
      {TRANSLATION_REVIEW_GROUPS.map((group) => {
        const items = review.items.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="mt-6">
            <h2 className="text-lg font-bold">{`${TRANSLATION_REVIEW_HEADINGS[group]} (${items.length})`}</h2>
            <ul>
              {items.map((item) => (
                <TranslationReviewRow key={item.workId} item={item} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
