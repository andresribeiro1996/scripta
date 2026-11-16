import { parseBookDate, type LibraryBook } from "../library/libraryView.js";

export function shouldMarkFeedSeen({ focused, rowVisible, loaded, failed, fetching, sent }: { focused: boolean; rowVisible: boolean; loaded: boolean; failed: boolean; fetching: boolean; sent: boolean }): boolean {
  return focused && rowVisible && loaded && !failed && !fetching && !sent;
}

export function readingNow(books: LibraryBook[] | undefined): LibraryBook[] {
  const time = (book: LibraryBook) => parseBookDate(book.DateLastRead)?.getTime() ?? -Infinity;
  return (books ?? []).filter((book) => book.ReadStatus === 1).sort((a, b) => time(b) - time(a));
}
