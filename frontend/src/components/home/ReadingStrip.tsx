import { Link } from "react-router-dom";
import { bookKey, readingPercent, type LibraryBook } from "@scripta/shared";
import { bookHref } from "../../lib/libraryView";
import { BookCover } from "../book/BookCover";
import { PANEL, PANEL_HEADING } from "../page/surfaceClasses";

const LIBRARY_LINK = "inline-flex min-h-11 items-center font-semibold text-(--color-accent)";

export function ReadingStrip({ books, works }: { books: LibraryBook[]; works: Record<string, string> | undefined }) {
  return (
    <section aria-labelledby="home-reading" className={`${PANEL} px-4.5 pb-4.5 pt-3.5`}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 id="home-reading" className={PANEL_HEADING}>Your reading{books.length > 0 ? <span className="ml-1.5 font-normal text-(--color-text-dim)">{books.length}</span> : null}</h2>
        <Link to="/dashboard/library?status=reading" className={LIBRARY_LINK}>Library →</Link>
      </div>
      {books.length === 0 ? (
        <p className="text-(--color-text-dim)">Nothing in progress. <Link to="/dashboard/library" className="inline-flex min-h-11 items-center font-semibold text-(--color-accent)">Pick something from your library</Link></p>
      ) : (
        <div className="grid grid-cols-5 gap-2.5">
          {books.slice(0, 5).map((book) => {
            const percent = readingPercent(book);
            const title = String(book.Title ?? "");
            return (
              <Link key={bookKey(book)} to={bookHref(bookKey(book), works)} aria-label={percent === null ? title : `${title}, ${percent}% read`} className="group flex min-w-0 flex-col gap-1.5">
                <BookCover book={book} />
                {percent === null ? null : (
                  <span className="block h-0.75 overflow-hidden rounded-xs bg-(--color-border)">
                    <span className="block h-full bg-(--color-accent)" style={{ width: `${percent}%` }} />
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
