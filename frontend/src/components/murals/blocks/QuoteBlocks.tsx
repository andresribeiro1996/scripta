import { resolveQuote, resolveQuoteCollection, type MuralBlock } from "../../../lib/murals";
import { EmptyBlockState } from "./BookBlocks";

/** One featured highlight, shown large — the "top quote from a book"
 *  case. `Annotation` (a Kobo/Goodreads note attached to the highlight,
 *  distinct from the highlighted text itself) renders underneath when
 *  present, same field the old viewer showed alongside a highlight.
 *
 *  Sizes are `em` (see BookBlocks.tsx's MiniBookTile comment for why) —
 *  the quote text itself has no explicit color so it inherits the
 *  block's (possibly customized) `textColor`; the annotation and
 *  attribution stay their own muted color regardless, same as every
 *  secondary/meta line in these block views. */
export function QuoteBlockView({ block, books }: { block: Extract<MuralBlock, { type: "quote" }>; books: Array<Record<string, unknown>> }) {
  const resolved = resolveQuote(block, books);
  if (!resolved) {
    return <EmptyBlockState message="Pick a quote for this spotlight." />;
  }
  const { book, highlight } = resolved;
  return (
    <div className="flex h-full flex-col justify-center gap-3 overflow-y-auto p-4">
      <p className="text-[1.1em] leading-snug italic">"{String(highlight.Text ?? "")}"</p>
      {highlight.Annotation ? <p className="text-[0.85em] text-(--color-text-dim)">{String(highlight.Annotation)}</p> : null}
      <p className="text-[0.85em] font-medium text-(--color-text-dim)">
        — {String(book.Title ?? "Untitled")}, {String(book.Attribution ?? "Unknown author")}
      </p>
    </div>
  );
}

/** Several curated highlights together, possibly spanning different
 *  books — the multi-quote version of QuoteBlockView. */
export function QuoteCollectionBlockView({
  block,
  books
}: {
  block: Extract<MuralBlock, { type: "quoteCollection" }>;
  books: Array<Record<string, unknown>>;
}) {
  const resolved = resolveQuoteCollection(block, books);
  return (
    <div className="flex h-full flex-col overflow-hidden p-2.5">
      <div className="mb-1.5 shrink-0 truncate text-[1.1em] font-semibold">{block.title || "Untitled quotes"}</div>
      {resolved.length === 0 ? (
        <EmptyBlockState message="No quotes picked yet." />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {resolved.map(({ book, highlight }, i) => (
            <div key={String(highlight.BookmarkID ?? i)} className="border-l-2 border-(--color-accent) pl-2.5">
              <p className="text-[0.9em] leading-snug italic">"{String(highlight.Text ?? "")}"</p>
              <p className="mt-0.5 text-[0.75em] text-(--color-text-dim)">— {String(book.Title ?? "Untitled")}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
