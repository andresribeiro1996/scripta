import { resolveQuote, resolveQuoteCollection, type MuralBlock } from "../../../lib/murals";
import { useT } from "../../../i18n";
import { BlockEyebrow, EmptyBlockState } from "./BookBlocks";

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
  const t = useT();
  const resolved = resolveQuote(block, books);
  if (!resolved) {
    return <EmptyBlockState message={t("muralEditor.pickQuote")} />;
  }
  const { book, highlight } = resolved;
  return (
    <div className="flex h-full flex-col justify-center gap-3 overflow-y-auto block-p-4">
      <p className="text-[1.1em] leading-snug italic">{t("muralEditor.quoted", { text: String(highlight.Text ?? "") })}</p>
      {highlight.Annotation ? <p className="text-[0.85em] text-(--color-text-dim)">{String(highlight.Annotation)}</p> : null}
      <p className="text-[0.85em] font-medium text-(--color-text-dim)">
        — {String(book.Title ?? t("library.untitled"))}, {String(book.Attribution ?? t("library.unknownAuthor"))}
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
  const t = useT();
  const resolved = resolveQuoteCollection(block, books);
  return (
    <div className="flex h-full flex-col overflow-hidden block-p-2.5">
      <BlockEyebrow>{block.title || t("muralEditor.untitledQuotes")}</BlockEyebrow>
      {resolved.length === 0 ? (
        <EmptyBlockState message={t("muralEditor.noQuotesPicked")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {resolved.map(({ book, highlight }, i) => (
            <div key={String(highlight.BookmarkID ?? i)} className="border-l-2 border-[var(--block-accent,var(--color-accent))] pl-2.5">
              <p className="text-[0.9em] leading-snug italic">{t("muralEditor.quoted", { text: String(highlight.Text ?? "") })}</p>
              <p className="mt-0.5 text-[0.75em] text-(--color-text-dim)">— {String(book.Title ?? t("library.untitled"))}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
