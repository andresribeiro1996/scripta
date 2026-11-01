// The library mutations, in one place. They used to be closures inside
// LibraryScreen, which was fine while every sheet was a modal rendered by that
// same screen. Now each sheet is its own route, so the routes need the same
// writes — and react-query means they act on exactly the same cached library.
//
// Every one goes through attemptUpdate, which is what keeps a failed save from
// being reported as a success.
import {
  addReaderNote,
  bookKey,
  clearBookCover,
  deleteBooks,
  localDay,
  newId,
  removeReaderNote,
  moveUnit,
  restoreReadState,
  saveFailureMessage,
  setBookCover,
  setBookCoverUrl,
  setReadStatus,
  setRating as rateBook,
  type FinishRating,
  type LibraryChange,
  type LibraryData,
  type PerCardStyle,
  type ReadSnapshot,
  type ReadStatus,
} from "@scripta/shared";
import type { GalleryImage } from "../../gallery/api";
import { assertSaved, attemptUpdate } from "../lib/attemptUpdate";
import { buildMergedLibrary } from "../lib/mergeAndSave";
import { useToast } from "../../../ui/ToastHost";
import { useLibrary } from "./useLibrary";
import { getLocale, t } from "../../../i18n";

export function useLibraryActions(onError?: (message: string) => void) {
  const { updateLibrary, submit } = useLibrary();
  const { show } = useToast();
  const report = onError ?? ((message: string) => show(message, "error"));

  function run(mutate: (data: LibraryData) => LibraryData, failureMessage: string, onSuccess?: () => void) {
    return attemptUpdate(() => updateLibrary(mutate), (error) => report(saveFailureMessage(error, failureMessage, getLocale())), onSuccess);
  }

  function runChange(change: LibraryChange, failureMessage: string) {
    return attemptUpdate(async () => assertSaved(await submit(change)), (error) => report(saveFailureMessage(error, failureMessage, getLocale())));
  }

  function mapBook(key: string, change: (book: Record<string, unknown>) => Record<string, unknown>) {
    return (data: LibraryData): LibraryData => ({
      ...data,
      books: data.books.map((book) => (bookKey(book) === key ? change(book) : book)),
    });
  }

  return {
    run,

    renameLibrary: (name: string) => run((data) => ({ ...data, name }), t("library.renameFailed")),

    merge: async (parsed: LibraryData) => {
      await updateLibrary((data) => buildMergedLibrary(data, parsed), "import");
    },

    addBook: async (book: Record<string, unknown>) => {
      assertSaved(await submit({ kind: "add", book }));
    },

    reorder: (key: string, direction: "up" | "down") =>
      run((data) => {
        const books = moveUnit(data.books, data.groups ?? [], key, direction);
        return books === data.books ? data : { ...data, books };
      }, t("library.reorderFailed")),

    setStatus: (book: Record<string, unknown>, status: ReadStatus) => {
      const day = localDay();
      if (setReadStatus(book, status, day) === book) return;
      return runChange({ kind: "book", bookKey: bookKey(book), readStatus: status, day }, t("library.statusFailed"));
    },

    setRating: (book: Record<string, unknown>, rating: FinishRating) => {
      if (rateBook(book, rating) === book) return Promise.resolve(true);
      return runChange({ kind: "book", bookKey: bookKey(book), rating }, t("library.ratingFailed"));
    },

    addNote: (book: Record<string, unknown>, text: string) =>
      run(mapBook(bookKey(book), (b) => addReaderNote(b, text, localDay(), newId())), t("library.noteSaveFailed")),

    deleteNote: (book: Record<string, unknown>, bookmarkId: string) =>
      run(mapBook(bookKey(book), (b) => removeReaderNote(b, bookmarkId)), t("library.noteDeleteFailed")),

    restoreRead: (book: Record<string, unknown>, before: ReadSnapshot) =>
      run(mapBook(bookKey(book), (b) => restoreReadState(b, before)), t("library.undoStatusFailed")),

    saveBookStyle: (book: Record<string, unknown>, style: PerCardStyle | undefined) =>
      run(mapBook(bookKey(book), (b) => ({ ...b, _style: style })), t("shell.styleSaveFailed")),

    saveBookCover: (book: Record<string, unknown>, image: GalleryImage) =>
      run(mapBook(bookKey(book), (b) => setBookCover(b, image.id, image.url)), t("library.coverSaveFailed")),

    saveBookCoverUrl: (book: Record<string, unknown>, url: string) =>
      run(mapBook(bookKey(book), (b) => setBookCoverUrl(b, url)), t("library.coverSaveFailed")),

    removeBookCover: (book: Record<string, unknown>) =>
      run(mapBook(bookKey(book), (b) => clearBookCover(b)), t("library.coverSaveFailed")),

    deleteBooks: (keys: Set<string>, onSuccess: () => void) =>
      run(
        (data) => deleteBooks(data, keys),
        t("library.deleteBooksFailed"),
        onSuccess,
      ),
  };
}
