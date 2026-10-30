import type { CharacterSubject } from "@scripta/shared";
import { useMemo } from "react";
import { CoverImage } from "./BookCard";
import { LibraryIcon } from "./NavIcons";

export function CharacterHeader({ subject }: { subject: CharacterSubject }) {
  const { label, coverUrl } = subject.scope;
  const cover = useMemo(() => (coverUrl ? { _coverUrl: coverUrl } : null), [coverUrl]);
  return (
    <div role="group" aria-label={`Characters from ${label}`} className="mb-4 flex items-center gap-3">
      <span className="relative flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-(--color-border) text-(--color-text-dim)">
        {cover ? <CoverImage book={cover} /> : <LibraryIcon size={16} />}
      </span>
      <p className="min-w-0 flex-1 text-xs font-bold text-(--color-text-dim)">{`Characters · ${label}`}</p>
    </div>
  );
}
