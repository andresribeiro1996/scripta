import { canonicalByKey, canonicalWorkIds, firstKeyPerWork } from "../library/index.js";
import { canonicalBoard as boardOf, storedIds } from "./domain/board.js";
import { characterSnapshot, type CharacterSubject, type HistogramCell, type Placement, type PublicBookData, type TierlistData } from "@scripta/shared";

function selfMap(ids: string[]) {
  return canonicalByKey(new Map(ids.map((id) => [id, id])));
}

export function boardCanonical(data: unknown): Map<string, string> {
  return selfMap(storedIds(data));
}

export function canonicalBoard(data: unknown, known?: Map<string, string>): TierlistData {
  return boardOf(data, known ?? boardCanonical(data));
}

export function canonicalFirst(ids: string[]): { canonical: Map<string, string>; first: Set<string> } {
  const canonical = selfMap(ids);
  return { canonical, first: new Set(firstKeyPerWork(ids, canonical).values()) };
}

export function characterView(pool: string[]): { canonical: Map<string, string>; first: Set<string> } {
  return { canonical: new Map(pool.map((id) => [id, id])), first: new Set(pool) };
}

export function histogramToWorks(cells: HistogramCell[], canonical: Map<string, string>, first: Set<string>): HistogramCell[] {
  return cells.flatMap((cell) => (first.has(cell.workId) ? [{ workId: canonical.get(cell.workId)!, tierId: cell.tierId, votes: cell.votes }] : []));
}

export function placementsToWorks(placements: Placement[], canonical: Map<string, string>, first: Set<string>): Placement[] {
  return placements.flatMap((placement) => (first.has(placement.workId) ? [{ workId: canonical.get(placement.workId)!, tierId: placement.tierId }] : []));
}

export function placementsFromWorks(placements: Array<{ workId: string; tierId: string }>, ids: string[], storedByCanonical: Map<string, string>): Placement[] | null {
  const stored: Placement[] = [];
  for (const [index, placement] of placements.entries()) {
    const workId = storedByCanonical.get(ids[index]!);
    if (!workId) return null;
    stored.push({ workId, tierId: placement.tierId });
  }
  return stored;
}

export function characterBooks(subject: CharacterSubject, pool: string[]): PublicBookData[] {
  const byId = new Map(characterSnapshot(subject).map((book) => [book.workId!, book]));
  return pool.flatMap((id) => byId.get(id) ?? []);
}

export function boardBooks(pool: string[], snapshot: unknown[] | null, live: () => PublicBookData[]): PublicBookData[] {
  if (!snapshot) return live();
  const entries = snapshot.filter((book): book is PublicBookData => typeof book === "object" && book !== null);
  const canonical = canonicalWorkIds(entries.flatMap((book) => (typeof book.workId === "string" ? [book.workId] : [])));
  const byWork = new Map<string, PublicBookData>();
  for (const book of entries) {
    const work = typeof book.workId === "string" ? canonical.get(book.workId) : undefined;
    if (work && !byWork.has(work)) byWork.set(work, { ...book, workId: work });
  }
  return pool.every((id) => byWork.has(id)) ? pool.map((id) => byWork.get(id)!) : live();
}
