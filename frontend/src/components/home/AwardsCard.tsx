import { useState } from "react";
import { Link } from "react-router-dom";
import { awardCardModel, firstUndismissed, type AwardAnnouncement } from "@scripta/shared";
import type { LibraryDocument } from "../../api/library";
import { BookCover } from "../book/BookCover";
import { CARD } from "../page/surfaceClasses";
import { CloseIcon } from "../Toolbar";

const STORAGE_KEY = "dismissedAwards";

function readDismissed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DOMException) return new Set();
    throw error;
  }
}

function writeDismissed(keys: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

export function AwardsCard({ announcements, library }: { announcements: readonly AwardAnnouncement[]; library: LibraryDocument | null }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const announcement = firstUndismissed(announcements, dismissed);
  const model = announcement ? awardCardModel(announcement, library) : null;
  if (!model) return null;

  const content = (
    <>
      {model.coverUrl ? <BookCover book={{ _coverUrl: model.coverUrl }} title={model.subtitle} width={40} /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-bold break-words">{model.title}</span>
        <span className="line-clamp-2 break-words text-(--color-text-dim)">{model.subtitle}</span>
        {model.shelfLine ? <span className="font-semibold text-(--color-accent)">{model.shelfLine}</span> : null}
      </span>
    </>
  );
  const bodyClass = "flex min-h-11 min-w-0 flex-1 items-center gap-4 py-3.5";
  const dismiss = () => {
    const next = new Set(dismissed).add(model.key);
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div className={`${CARD} flex items-center gap-2 pl-4.5 pr-2`}>
      {model.target.kind === "work" ? (
        <Link to={`/work/${model.target.id}`} className={`group ${bodyClass}`}>{content}</Link>
      ) : (
        <div className={bodyClass}>{content}</div>
      )}
      <button type="button" aria-label="Dismiss" onClick={dismiss} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)">
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
