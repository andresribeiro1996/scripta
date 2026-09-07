// Moved to packages/shared/src/library/merge.ts (Task 3A) so backend can
// reuse the same bookKey/merge logic (Task 4B) instead of growing a
// second copy. Re-exported here so every existing `from "./lib/merge"` /
// `from "../lib/merge"` import keeps working unchanged.
export { bookKey, mergeBookLists, mergeLibraryData } from "@scripta/shared";
