import { useQuery } from "@tanstack/react-query";
import { bookMetadataOptions, validBookRating } from "../lib/bookMetadata";

export function BookSummary({ book }: { book: Record<string, unknown> }) {
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
                {personalRating}/5
              </p>
              <p className="mt-0.5 text-xs text-(--color-text-dim)">Your rating</p>
            </div>
          )}
          {data?.rating !== null && data?.rating !== undefined && (
            <div>
              <p className="text-sm font-semibold">
                <span aria-hidden="true" className="text-(--color-accent)">
                  ★{" "}
                </span>
                {data.rating.toFixed(1)}/5
              </p>
              <p className="mt-0.5 text-xs text-(--color-text-dim)">
                Open Library{data.ratingCount > 0 ? ` · ${data.ratingCount.toLocaleString()} ratings` : ""}
              </p>
            </div>
          )}
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">About this book</h3>
        {isPending ? (
          <p role="status" className="text-sm text-(--color-text-dim)">
            Loading summary and rating…
          </p>
        ) : isError ? (
          <div className="text-sm text-(--color-text-dim)">
            <p>Book information couldn’t be loaded.</p>
            <button onClick={() => void refetch()} className="min-h-11 font-semibold text-(--color-accent)">
              Try again
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm leading-6 whitespace-pre-wrap break-words">
              {data?.summary || "No summary available for this book yet."}
            </p>
            {data && (
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-11 items-center text-xs text-(--color-text-dim) hover:text-(--color-accent)"
              >
                Source: Open Library ↗
              </a>
            )}
          </>
        )}
      </div>
    </section>
  );
}
