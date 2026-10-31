import type { BookScreenModel, WorkEdition } from "@scripta/shared";

export function statusBadgeLabel(model: Pick<BookScreenModel, "status" | "feeling">): string | null {
  if (!model.status) return null;
  const feeling = model.feeling?.options.find((option) => option.selected);
  return feeling ? `${model.status.label} · ${feeling.label}` : model.status.label;
}

export function otherEditionCovers(editions: WorkEdition[], currentUrl: string | null): string[] {
  const urls = editions.flatMap((edition) => (edition.coverUrl && edition.coverUrl !== currentUrl ? [edition.coverUrl] : []));
  return [...new Set(urls)];
}
