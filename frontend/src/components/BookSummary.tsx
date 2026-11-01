import { useQuery } from "@tanstack/react-query";
import { decimalText } from "@scripta/shared";
import { bookMetadataOptions, summarySourceName, validBookRating } from "../lib/bookMetadata";
import { useLocale, useT } from "../i18n";

export function BookSummary({ book }: { book: Record<string, unknown> }) {
  const t = useT();
  const locale = useLocale();
  const personalRating = validBookRating(book.Rating);
  const { data, isPending, isError, refetch } = useQuery(bookMetadataOptions(book));
  return (
    <section className="mt-5 space-y-4">
      {(personalRating !== null || (data?.rating !== null && data?.rating !== undefined)) && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {personalRating !== null && (
            <div>
              <p className="text-sm font-semibold">
                <span aria-hidden="true" className="text-(--color-accent)">
                  ★{" "}
                </span>
                {decimalText(personalRating, locale)}/5
              </p>
              <p className="mt-0.5 text-xs text-(--color-text-dim)">{t("library.yourRating")}</p>
            </div>
          )}
          {data?.rating !== null && data?.rating !== undefined && (
            <div>
              <p className="text-sm font-semibold">
                <span aria-hidden="true" className="text-(--color-accent)">
                  ★{" "}
                </span>
                {decimalText(data.rating, locale, 1)}/5
              </p>
              <p className="mt-0.5 text-xs text-(--color-text-dim)">
                {data.ratingCount > 0 ? t("library.ratingsFrom", { count: data.ratingCount, formatted: data.ratingCount.toLocaleString(locale === "pt-PT" ? "pt-PT" : undefined) }) : "Open Library"}
              </p>
            </div>
          )}
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("library.aboutThisBook")}</h3>
        {isPending ? (
          <p role="status" className="text-sm text-(--color-text-dim)">
            {t("library.summaryLoading")}
          </p>
        ) : isError ? (
          <div className="text-sm text-(--color-text-dim)">
            <p>{t("library.bookInfoFailed")}</p>
            <button onClick={() => void refetch()} className="min-h-11 font-semibold text-(--color-accent)">
              {t("shell.tryAgain")}
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm leading-6 whitespace-pre-wrap break-words">
              {data?.summary || t("library.noSummary")}
            </p>
            {data?.sourceUrl && (
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-11 items-center text-xs text-(--color-text-dim) hover:text-(--color-accent)"
              >
                {t("library.summarySource", { name: summarySourceName(data) })}
              </a>
            )}
          </>
        )}
      </div>
    </section>
  );
}
