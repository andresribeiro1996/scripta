// Moved to packages/shared/src/library/csv.ts (Task 3A) so backend can
// reuse the same CSV parser (Task 4B) instead of growing a second copy.
// See lib/merge.ts's own comment for why this is a thin re-export.
export { parseCsv, csvRowsToObjects } from "@scripta/shared";
