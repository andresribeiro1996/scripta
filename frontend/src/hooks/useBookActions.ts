import { useQueryClient } from "@tanstack/react-query";
import {
  addReaderNote,
  newId,
  removeReaderNote,
  restoreReadState,
  saveFailureMessage,
  setRating,
  type FinishRating,
  type ReadSnapshot
} from "@scripta/shared";
import type { GalleryImage } from "../api/gallery";
import type { LibraryDocument } from "../api/library";
import { useToast } from "../components/Toaster";
import { clearBookCover, setBookCover } from "../lib/bookCovers";
import type { PerCardStyle } from "../lib/libraryStyle";
import { localDay, type LibraryBook as Book, type ReadStatus } from "../lib/libraryView";
import { bookKey } from "../lib/merge";
import { useLibrary } from "./useLibrary";
import { useLibrarySaver } from "./useLibrarySaver";

export function useBookActions() {
  const queryClient = useQueryClient();
  const saver = useLibrarySaver();
  const { updateLibrary } = useLibrary();
  const toast = useToast();

  async function saveStyle(book: Book, style: PerCardStyle | undefined) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? { ...b, _style: style } : b))
      }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save the style change."), kind: "error" });
    }
  }

  async function setStatus(book: Book, status: ReadStatus): Promise<boolean> {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return false;
    const key = bookKey(book);
    const day = localDay();
    const result = await saver.submit(status === 2 ? { kind: "book", bookKey: key, readStatus: 2, day } : { kind: "book", bookKey: key, readStatus: status });
    if (!result.ok) toast({ message: saveFailureMessage(result.error, "Couldn't save the status change."), kind: "error" });
    return result.ok;
  }

  async function setBookRating(book: Book, rating: FinishRating): Promise<boolean> {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return false;
    const key = bookKey(book);
    if (setRating(book, rating) === book) return true;
    const result = await saver.submit({ kind: "book", bookKey: key, rating });
    if (!result.ok) toast({ message: saveFailureMessage(result.error, "Couldn't save the rating."), kind: "error" });
    return result.ok;
  }

  async function addNote(book: Book, text: string): Promise<boolean> {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return false;
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? addReaderNote(b, text, localDay(), newId()) : b))
      }));
      return true;
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save your note."), kind: "error" });
      return false;
    }
  }

  async function deleteNote(book: Book, bookmarkId: string): Promise<boolean> {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return false;
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? removeReaderNote(b, bookmarkId) : b))
      }));
      return true;
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't delete the note."), kind: "error" });
      return false;
    }
  }

  async function restoreRead(book: Book, before: ReadSnapshot): Promise<boolean> {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return false;
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? restoreReadState(b, before) : b))
      }));
      return true;
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't undo the status change."), kind: "error" });
      return false;
    }
  }

  async function saveCover(book: Book, image: GalleryImage) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? setBookCover(b, image.id, image.url) : b))
      }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save the cover change."), kind: "error" });
    }
  }

  async function removeCover(book: Book) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? clearBookCover(b) : b))
      }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save the cover change."), kind: "error" });
    }
  }

  return { saveStyle, setStatus, setRating: setBookRating, addNote, deleteNote, restoreRead, saveCover, removeCover };
}
