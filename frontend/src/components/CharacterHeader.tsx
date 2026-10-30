import type { CharacterSubject } from "@scripta/shared";
import { CoverImage } from "./BookCard";

export function CharacterHeader({ subject }: { subject: CharacterSubject }) {
  const { label, coverUrl } = subject.scope;
  return (
    <div role="group" aria-label={`Characters from ${label}`} className="mb-4 flex items-center gap-3">
      <span className="relative block h-12 w-8 shrink-0 overflow-hidden rounded bg-(--color-border)">
        <CoverImage book={{ Title: label, _coverUrl: coverUrl ?? undefined }} />
      </span>
      <p className="min-w-0 flex-1 text-xs font-bold text-(--color-text-dim)">{`Characters · ${label}`}</p>
    </div>
  );
}
