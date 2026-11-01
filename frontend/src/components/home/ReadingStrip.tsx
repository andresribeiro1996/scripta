import { Link } from "react-router-dom";
import { bookKey, readingPercent, type LibraryBook } from "@scripta/shared";
import { bookHref } from "../../lib/libraryView";
import { BookCover } from "../book/BookCover";
import { PANEL, PANEL_HEADER, PANEL_HEADING } from "../page/surfaceClasses";
import { useT } from "../../i18n";

const LIBRARY_LINK = "inline-flex min-h-11 items-center font-semibold text-(--color-accent)";

export function ReadingStrip({ books, works }: { books: LibraryBook[]; works: Record<string, string> | undefined }) {
  const t = useT();
  const [beforeLink, afterLink] = t("book.nothingInProgress").split("{link}");
  return (
    <section aria-labelledby="home-reading" className={PANEL}>
      <div className={PANEL_HEADER}>
        <h2 id="home-reading" className={PANEL_HEADING}>{t("book.yourReading")}{books.length > 0 ? <span className="ml-1.5 font-normal text-(--color-text-dim)">{books.length}</span> : null}</h2>
        <Link to="/dashboard/library?status=reading" className={LIBRARY_LINK}>{t("book.libraryArrow")}</Link>
      </div>
      {books.length === 0 ? (
        <p className="px-4.5 pb-3.5 text-(--color-text-dim)">{beforeLink}<Link to="/dashboard/library" className="inline-flex min-h-11 items-center font-semibold text-(--color-accent)">{t("book.pickFromLibrary")}</Link>{afterLink}</p>
      ) : (
        <div className="grid grid-cols-5 gap-2.5 px-4.5 pb-4.5 pt-1">
          {books.slice(0, 5).map((book) => {
            const percent = readingPercent(book);
            const title = String(book.Title ?? "");
            return (
              <Link key={bookKey(book)} to={bookHref(bookKey(book), works)} aria-label={percent === null ? title : t("book.readingPercentAria", { title, percent })} className="group flex min-w-0 flex-col gap-1.5">
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
