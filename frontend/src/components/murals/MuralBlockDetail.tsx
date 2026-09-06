import { useRef, useState } from "react";
import type { GalleryImage } from "../../api/gallery";
import type { ResolvedTierlist } from "../../api/tierlists";
import {
  muralBlockTitle,
  STAT_METRIC_LABELS,
  resolveShelfBooks,
  resolveQuote,
  resolveQuoteCollection,
  type MuralBlock
} from "../../lib/murals";
import { bookKey } from "../../lib/merge";
import { computeStat } from "../../lib/muralStats";
import { CoverImage } from "../BookCard";
import { BookSummary } from "../BookSummary";
import { Sheet } from "../Sheet";

export function MuralBlockDetail({
  block,
  books,
  images,
  statsOverride,
  tierlistData,
  onClose
}: {
  block: MuralBlock;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  statsOverride?: Record<string, number>;
  tierlistData?: (tierlistId: string) => ResolvedTierlist | undefined;
  onClose: () => void;
}) {
  const [selectedBook, setSelectedBook] = useState<Record<string, unknown> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const collectionScroll = useRef(0);
  const spotlight = block.type === "spotlight" ? books.find((book) => bookKey(book) === block.bookKey) : undefined;
  const book = selectedBook ?? spotlight;
  const tierlist = block.type === "tierlist" ? tierlistData?.(block.tierlistId) : undefined;
  const groups =
    block.type === "shelf"
      ? [{ title: "", books: resolveShelfBooks(block, books) }]
      : block.type === "currentlyReading"
        ? [{ title: "", books: books.filter((item) => item.ReadStatus === 1) }]
        : tierlist
          ? [...tierlist.tiers.map((tier) => ({ title: tier.label, keys: tier.bookKeys })), { title: "Unranked", keys: tierlist.pool }].map(
              (group) => ({
                title: group.title,
                books: group.keys
                  .map((key) => books.find((item) => bookKey(item) === key))
                  .filter((item): item is Record<string, unknown> => Boolean(item))
              })
            )
          : undefined;
  const image = block.type === "image" ? images.find((item) => item.id === block.imageId) : undefined;
  const quotes =
    block.type === "quoteCollection"
      ? resolveQuoteCollection(block, books)
      : block.type === "quote"
        ? [resolveQuote(block, books)].filter((quote) => quote !== null)
        : [];
  return (
    <Sheet
      title={book ? "Book details" : muralBlockTitle(block, books, tierlist?.name)}
      onBack={
        selectedBook
          ? () => {
              setSelectedBook(null);
              requestAnimationFrame(() => contentRef.current?.scrollTo(0, collectionScroll.current));
            }
          : undefined
      }
      onClose={onClose}
    >
      <div ref={contentRef} className="max-h-[min(70dvh,40rem)] overflow-y-auto overscroll-contain px-3 pt-1 pb-5 text-base">
        {book ? (
          <div>
            <div className="flex items-start gap-4">
              <div className="relative aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-lg bg-(--color-bg)">
                <CoverImage book={book} fit="contain" />
              </div>
              <div className="min-w-0 pt-1">
                <h3 className="text-xl leading-snug font-semibold">{String(book.Title ?? "Untitled")}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(--color-text-dim)">{String(book.Attribution ?? "Unknown author")}</p>
              </div>
            </div>
            {block.type === "spotlight" && block.caption && (
              <p className="mt-5 text-base leading-relaxed whitespace-pre-wrap">{block.caption}</p>
            )}
            <BookSummary book={book} />
          </div>
        ) : groups ? (
          <div className="space-y-5">
            {groups.map((group, index) => (
              <section key={index}>
                {group.title && <h3 className="mb-3 text-base font-semibold">{group.title}</h3>}
                {group.books.length === 0 ? (
                  <p className="text-sm text-(--color-text-dim)">No books here yet.</p>
                ) : (
                  <div className="grid grid-cols-2 items-start gap-x-4 gap-y-5">
                    {group.books.map((item, itemIndex) => (
                      <button
                        key={itemIndex}
                        onClick={() => {
                          collectionScroll.current = contentRef.current?.scrollTop ?? 0;
                          setSelectedBook(item);
                          contentRef.current?.scrollTo(0, 0);
                        }}
                        className="min-w-0 text-left"
                      >
                        <div className="relative mb-2 aspect-[2/3] overflow-hidden rounded-lg bg-(--color-border)">
                          <CoverImage book={item} fit="contain" />
                        </div>
                        <p className="line-clamp-2 text-sm leading-5 font-semibold">{String(item.Title ?? "Untitled")}</p>
                        <p className="mt-1 line-clamp-2 text-sm leading-5 text-(--color-text-dim)">
                          {String(item.Attribution ?? "Unknown author")}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : block.type === "stats" ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 py-1">
            {block.metrics.map((metric) => (
              <div key={metric} className="min-w-0">
                <p className="text-3xl font-bold text-(--color-accent)">
                  {statsOverride && metric in statsOverride ? statsOverride[metric] : computeStat(metric, books)}
                </p>
                <p className="mt-1 text-sm leading-5 text-(--color-text-dim)">{STAT_METRIC_LABELS[metric]}</p>
              </div>
            ))}
          </div>
        ) : image ? (
          <div>
            <img src={image.url} alt={block.type === "image" ? block.caption || "" : ""} className="max-h-[52dvh] w-full object-contain" />
            {block.type === "image" && block.caption && <p className="mt-3 text-base">{block.caption}</p>}
          </div>
        ) : block.type === "text" && (block.heading || block.body) ? (
          <div className="text-base leading-7 whitespace-pre-wrap break-words">{block.body || block.heading}</div>
        ) : quotes.length > 0 ? (
          <div className="space-y-6">
            {quotes.map(
              (quote, index) =>
                quote && (
                  <figure key={index}>
                    <blockquote className="text-lg leading-relaxed">“{String(quote.highlight.Text ?? "")}”</blockquote>
                    {quote.highlight.Annotation ? (
                      <p className="mt-3 text-sm leading-relaxed text-(--color-text-dim)">{String(quote.highlight.Annotation)}</p>
                    ) : null}
                    <figcaption className="mt-3 text-sm leading-5 text-(--color-text-dim)">
                      {String(quote.book.Title ?? "Untitled")} · {String(quote.book.Attribution ?? "Unknown author")}
                    </figcaption>
                  </figure>
                )
            )}
          </div>
        ) : (
          <p className="py-5 text-sm text-(--color-text-dim)">
            {block.type === "quote" || block.type === "quoteCollection"
              ? "No quotes added yet."
              : block.type === "tierlist"
                ? "This tier list is unavailable."
                : block.type === "image"
                  ? "No image available."
                  : block.type === "spotlight"
                    ? "No book selected."
                    : "Nothing added yet."}
          </p>
        )}
      </div>
    </Sheet>
  );
}
