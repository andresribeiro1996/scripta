import type { LibraryChange } from "./libraryChange.js";

export type LibraryChangeRequest = { method: "POST" | "PATCH"; path: string; body: unknown };

export function libraryChangeRequest(change: LibraryChange): LibraryChangeRequest {
  if (change.kind === "membership") {
    return { method: "POST", path: `/library/groups/${encodeURIComponent(change.groupId)}/books`, body: { bookKey: change.bookKey, member: change.member } };
  }
  if (change.kind === "add") return { method: "POST", path: "/library/books/add", body: { book: change.book } };
  const { bookKey, readStatus, rating, day } = change;
  return { method: "PATCH", path: "/library/books", body: { bookKey, readStatus, rating, day: readStatus === 2 ? day : undefined } };
}
