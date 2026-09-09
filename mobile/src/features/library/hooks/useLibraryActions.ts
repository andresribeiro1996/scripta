// The library mutations, in one place. They used to be closures inside
// LibraryScreen, which was fine while every sheet was a modal rendered by that
// same screen. Now each sheet is its own route, so the routes need the same
// writes — and react-query means they act on exactly the same cached library.
//
// Every one goes through attemptUpdate, which is what keeps a failed save from
// being reported as a success.
import { Alert } from "react-native";
import {
  bookKey,
  clearBookCover,
  nextReadStatus,
  removeBooksFromAllGroups,
  reorderOnDrop,
  setBookCover,
  type LibraryData,
  type PerCardStyle,
} from "@scripta/shared";
import type { GalleryImage } from "../../gallery/api";
import { attemptUpdate } from "../lib/attemptUpdate";
import { buildMergedLibrary } from "../lib/mergeAndSave";
import { useLibrary } from "./useLibrary";

export function useLibraryActions() {
  const { updateLibrary } = useLibrary();

  function run(mutate: (data: LibraryData) => LibraryData, failureMessage: string, onSuccess?: () => void) {
    return attemptUpdate(() => updateLibrary(mutate), () => Alert.alert(failureMessage), onSuccess);
  }

  function mapBook(key: string, change: (book: Record<string, unknown>) => Record<string, unknown>) {
    return (data: LibraryData): LibraryData => ({
      ...data,
      books: data.books.map((book) => (bookKey(book) === key ? change(book) : book)),
    });
  }

  return {
    run,

    renameLibrary: (name: string) => run((data) => ({ ...data, name }), "Couldn't save the new name."),

    merge: async (parsed: LibraryData) => {
      await updateLibrary((data) => buildMergedLibrary(data, parsed));
    },

    addBook: async (book: Record<string, unknown>) => {
      await updateLibrary((data) => buildMergedLibrary(data, { books: [book] }));
    },

    reorder: (draggedKey: string, targetKey: string) =>
      run((data) => {
        const books = reorderOnDrop(data.books, data.groups ?? [], draggedKey, targetKey);
        return books === data.books ? data : { ...data, books };
      }, "Couldn't save the new order."),

    cycleStatus: (book: Record<string, unknown>) =>
      run(mapBook(bookKey(book), (b) => ({ ...b, ReadStatus: nextReadStatus(b.ReadStatus) })), "Couldn't save the status change."),

    saveBookStyle: (book: Record<string, unknown>, style: PerCardStyle | undefined) =>
      run(mapBook(bookKey(book), (b) => ({ ...b, _style: style })), "Couldn't save the style change."),

    saveBookCover: (book: Record<string, unknown>, image: GalleryImage) =>
      run(mapBook(bookKey(book), (b) => setBookCover(b, image.id, image.url)), "Couldn't save the cover change."),

    removeBookCover: (book: Record<string, unknown>) =>
      run(mapBook(bookKey(book), (b) => clearBookCover(b)), "Couldn't save the cover change."),

    deleteBooks: (keys: Set<string>, onSuccess: () => void) =>
      run(
        (data) => ({
          ...data,
          books: data.books.filter((book) => !keys.has(bookKey(book))),
          groups: removeBooksFromAllGroups(data.groups ?? [], keys),
        }),
        "Couldn't delete — nothing was changed.",
        onSuccess,
      ),
  };
}
