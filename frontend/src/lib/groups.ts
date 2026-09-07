// Moved to packages/shared/src/library/groups.ts (Task 3A). See
// lib/merge.ts's own comment for why this is a thin re-export.
export type { GroupType, Group } from "@scripta/shared";
export {
  makeGroup,
  createGroup,
  renameGroup,
  deleteGroup,
  addBookToGroup,
  removeBookFromGroup,
  setGroupStyle,
  removeBooksFromAllGroups,
  booksInGroup,
  orderedGroupBooks,
  deriveSeriesGroups
} from "@scripta/shared";
