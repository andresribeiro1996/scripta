import { router, useSegments } from "expo-router";
import { bookKey, readSnapshot, type ReadStatus } from "@scripta/shared";
import { bookToolPath } from "../../works/workPath";
import { useLibraryActions } from "./useLibraryActions";

export function useChangeStatus() {
  const { setStatus } = useLibraryActions();
  const segments = useSegments();
  return async function changeStatus(book: Record<string, unknown>, status: ReadStatus) {
    const before = readSnapshot(book);
    const wasFinished = book.ReadStatus === 2;
    const saved = await setStatus(book, status);
    if (saved && status === 2 && !wasFinished) router.push(`${bookToolPath(bookKey(book), "finished", segments)}?before=${encodeURIComponent(JSON.stringify(before))}` as never);
  };
}
