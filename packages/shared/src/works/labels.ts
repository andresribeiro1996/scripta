import type { ReaderProfile } from "../murals/murals.js";
import type { WorkEdition, WorkReadStatus } from "./types.js";

export function readerStatusLabel(status: WorkReadStatus): string {
  if (status === 2) return "Finished";
  if (status === 1) return "Reading";
  return "Wants to read";
}

export function readerCountsLabel(counts: { readers: number; finished: number }): string {
  if (counts.readers === 0) return "No readers yet";
  const readers = `${counts.readers} ${counts.readers === 1 ? "reader" : "readers"}`;
  return counts.finished > 0 ? `${readers} · ${counts.finished} finished` : readers;
}

export function gameOwnerLabel(owner: ReaderProfile | "app"): string {
  return owner === "app" ? "Scripta" : owner.username;
}

export function editionLabel(edition: WorkEdition): string {
  const parts = [edition.language, edition.year === null ? null : String(edition.year), edition.isbn].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "Edition details unknown";
}
