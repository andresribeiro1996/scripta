import type { LibraryChange } from "@scripta/shared";

export function libraryChangeRequest(change: LibraryChange): { path: string; method: "POST" | "PATCH"; body: unknown } {
  if (change.kind === "membership") {
    return { path: `/library/groups/${encodeURIComponent(change.groupId)}/books`, method: "POST", body: { bookKey: change.bookKey, member: change.member } };
  }
  if (change.kind === "add") return { path: "/library/books/add", method: "POST", body: { book: change.book } };
  const { kind: _kind, ...body } = change;
  return { path: "/library/books", method: "PATCH", body };
}
