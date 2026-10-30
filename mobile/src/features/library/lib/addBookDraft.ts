import { positiveInteger, setBookCover, setBookCoverUrl, type GalleryImage } from "@scripta/shared";

export type DraftCover =
  | { kind: "none" }
  | { kind: "search"; url: string }
  | { kind: "found"; url: string }
  | { kind: "upload"; image: GalleryImage };

export function coverAfterResult(current: DraftCover, resultCoverUrl: string | null): DraftCover {
  if (current.kind === "found" || current.kind === "upload") return current;
  return resultCoverUrl ? { kind: "search", url: resultCoverUrl } : { kind: "none" };
}

export function replacedUpload(previous: DraftCover, next: DraftCover): string | null {
  if (previous.kind !== "upload") return null;
  return next.kind === "upload" && next.image.id === previous.image.id ? null : previous.image.id;
}

export function abandonedUpload(cover: DraftCover, added: boolean): string | null {
  return cover.kind === "upload" && !added ? cover.image.id : null;
}

export async function uploadToDeleteOnExit(cover: DraftCover, pendingSave: Promise<boolean> | null): Promise<string | null> {
  return abandonedUpload(cover, pendingSave ? await pendingSave : false);
}

export function withDraftCover(book: Record<string, unknown>, cover: DraftCover): Record<string, unknown> {
  if (cover.kind === "upload") return setBookCover(book, cover.image.id, cover.image.url);
  if (cover.kind === "found") return setBookCoverUrl(book, cover.url);
  return book;
}

export function parsePages(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? positiveInteger(Number(trimmed)) : null;
}

export function coverStatusLabel(cover: DraftCover): "No cover yet" | "From search" | "Chosen" | "Uploaded" {
  switch (cover.kind) {
    case "none": return "No cover yet";
    case "search": return "From search";
    case "found": return "Chosen";
    case "upload": return "Uploaded";
  }
}
