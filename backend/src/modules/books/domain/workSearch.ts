import { normalizeWords } from "@scripta/shared";
import type { BookRow } from "./types.js";

export function workIdsOf(rows: BookRow[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.work_id ? [row.work_id] : [])))];
}

export function coveredFirst<T>(items: T[], workIdOf: (item: T) => string | null, hasCover: (item: T) => boolean, titleOf: (item: T) => string): T[] {
  const ordered = [...items];
  const seen = new Set<string>();
  ordered.forEach((first, at) => {
    const workId = workIdOf(first);
    if (workId === null || seen.has(workId)) return;
    seen.add(workId);
    if (hasCover(first)) return;
    const title = normalizeWords(titleOf(first));
    const covered = ordered.findIndex((item, index) => index > at && workIdOf(item) === workId && hasCover(item) && normalizeWords(titleOf(item)) === title);
    if (covered === -1) return;
    ordered[at] = ordered[covered] as T;
    ordered[covered] = first;
  });
  return ordered;
}

export function firstEditionPerWork(rows: BookRow[], canonical: Map<string, string>): Array<{ row: BookRow; workId: string | null }> {
  const editions = rows.map((row) => ({ row, workId: row.work_id ? canonical.get(row.work_id) ?? row.work_id : null }));
  const seen = new Set<string>();
  return coveredFirst(editions, ({ workId }) => workId, ({ row }) => row.cover_image_id !== null || row.ol_cover_id !== null, ({ row }) => row.title).filter(({ workId }) => {
    if (workId === null) return true;
    if (seen.has(workId)) return false;
    seen.add(workId);
    return true;
  });
}
