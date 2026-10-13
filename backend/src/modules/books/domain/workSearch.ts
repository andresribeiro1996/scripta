import type { BookRow } from "./types.js";

export function workIdsOf(rows: BookRow[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.work_id ? [row.work_id] : [])))];
}

export function firstEditionPerWork(rows: BookRow[], canonical: Map<string, string>): Array<{ row: BookRow; workId: string | null }> {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const workId = row.work_id ? canonical.get(row.work_id) ?? row.work_id : null;
    if (workId !== null && seen.has(workId)) return [];
    if (workId !== null) seen.add(workId);
    return [{ row, workId }];
  });
}
