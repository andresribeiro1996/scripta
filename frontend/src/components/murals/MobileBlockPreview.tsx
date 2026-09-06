import type { GalleryImage } from "../../api/gallery";
import type { ResolvedTierlist } from "../../api/tierlists";
import { bookKey } from "../../lib/merge";
import { computeStat } from "../../lib/muralStats";
import { muralBlockTitle, resolveQuote, resolveQuoteCollection, resolveShelfBooks, type MuralBlock } from "../../lib/murals";
import { CoverImage } from "../BookCard";

const PREVIEW_STAT_LABELS = {
  totalBooks: "Library",
  booksFinished: "Finished",
  booksFinishedThisYear: "This year",
  booksInProgress: "Reading",
  totalHighlights: "Highlights"
};

export function MobileBlockPreview({
  block,
  books,
  images,
  width,
  height,
  statsOverride,
  tierlistData
}: {
  block: MuralBlock;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  width: number;
  height: number;
  statsOverride?: Record<string, number>;
  tierlistData?: (id: string) => ResolvedTierlist | undefined;
}) {
  const title = muralBlockTitle(block, books, block.type === "tierlist" ? tierlistData?.(block.tierlistId)?.name : undefined);
  const compact = height < 64 || width < 80;
  const heading = <p className="shrink-0 truncate text-[14px] leading-5 font-semibold">{title}</p>;
  const placeholder = (
    <div className="flex h-full items-center justify-center gap-2 overflow-hidden p-2 text-[13px] text-(--color-text-dim)">
      <span aria-hidden="true">◇</span>
      {width >= 60 && <span className="truncate">{title}</span>}
    </div>
  );
  if (block.type === "empty") return null;
  if ((height < 32 || width < 48) && block.type !== "image" && block.type !== "spotlight") {
    const symbol =
      block.type === "text" ? "Aa" : block.type === "quote" || block.type === "quoteCollection" ? "“”" : block.type === "stats" ? "#" : "▤";
    return (
      <div className="flex h-full items-center justify-center overflow-hidden text-[16px] font-semibold" aria-hidden="true">
        {symbol}
      </div>
    );
  }
  if (block.type === "image") {
    const image = images.find((item) => item.id === block.imageId);
    return image ? <img src={image.url} alt={block.caption || ""} className="h-full w-full object-cover" /> : placeholder;
  }
  if (block.type === "spotlight") {
    const book = books.find((item) => bookKey(item) === block.bookKey);
    if (!book) return placeholder;
    return (
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          <CoverImage book={book} fit="contain" />
        </div>
        {height >= 110 && <div className="shrink-0 px-2 py-1.5">{heading}</div>}
      </div>
    );
  }
  if (block.type === "shelf" || block.type === "currentlyReading" || block.type === "tierlist") {
    const tierlist = block.type === "tierlist" ? tierlistData?.(block.tierlistId) : undefined;
    const resolved =
      block.type === "shelf"
        ? resolveShelfBooks(block, books)
        : block.type === "currentlyReading"
          ? books.filter((book) => book.ReadStatus === 1)
          : (tierlist?.tiers.flatMap((tier) => tier.bookKeys) ?? [])
              .map((key) => books.find((book) => bookKey(book) === key))
              .filter((book): book is Record<string, unknown> => Boolean(book));
    if (block.type === "shelf" && width >= 220 && height >= 72) {
      const coverWidth = (height - 12) * 0.75;
      const visible = resolved.slice(0, Math.max(1, Math.floor((width - 92) / (coverWidth + 8))));
      return (
        <div className="flex h-full gap-2 overflow-hidden p-1.5">
          <div className="flex w-20 shrink-0 flex-col">
            <div className="line-clamp-3 text-[14px] leading-5 font-semibold">{title}</div>
            <span className="mt-auto text-[12px] text-(--color-text-dim)">{resolved.length} books ›</span>
          </div>
          <div className="flex min-w-0 flex-1 justify-start gap-2 overflow-hidden">
            {visible.map((book, index) => (
              <div key={index} className="relative aspect-[3/4] h-full shrink-0 overflow-hidden rounded bg-(--color-bg)">
                <CoverImage book={book} fit="cover" />
              </div>
            ))}
          </div>
        </div>
      );
    }
    const visible = resolved.slice(0, Math.max(1, Math.floor((width - 16) / 80)));
    return (
      <div className="flex h-full flex-col gap-1 overflow-hidden px-2 pt-1 pb-1">
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1">{heading}</div>
          {width >= 120 && <span className="shrink-0 text-[12px] text-(--color-text-dim)">{resolved.length} ›</span>}
        </div>
        {!compact && (
          <div className="flex min-h-0 flex-1 justify-start gap-2">
            {visible.map((book, index) => (
              <div key={index} className="relative aspect-[3/4] h-full shrink-0 overflow-hidden rounded bg-(--color-bg)">
                <CoverImage book={book} fit="cover" />
              </div>
            ))}
          </div>
        )}
        {resolved.length === 0 && height >= 60 && <p className="text-[12px] text-(--color-text-dim)">No books yet</p>}
      </div>
    );
  }
  if (block.type === "stats") {
    const count = Math.max(1, Math.floor((width - 16) / 96));
    const visible = block.metrics.slice(0, count);
    if (visible.length === 0) return placeholder;
    return (
      <div className="flex h-full items-center gap-2 overflow-hidden p-2">
        {visible.map((metric) => (
          <div key={metric} className="min-w-0 flex-1">
            <p className="truncate text-[20px] leading-6 font-bold text-(--color-accent)">
              {statsOverride && metric in statsOverride ? statsOverride[metric] : computeStat(metric, books)}
            </p>
            {height >= 48 && <p className="truncate text-[12px] leading-4 text-(--color-text-dim)">{PREVIEW_STAT_LABELS[metric]}</p>}
          </div>
        ))}
        {visible.length < block.metrics.length && width >= 90 && (
          <span className="shrink-0 text-[12px] text-(--color-text-dim)">+{block.metrics.length - visible.length}</span>
        )}
      </div>
    );
  }
  const quote =
    block.type === "quote"
      ? resolveQuote(block, books)
      : block.type === "quoteCollection"
        ? resolveQuoteCollection(block, books)[0]
        : undefined;
  const body = block.type === "text" ? block.body : quote ? `“${String(quote.highlight.Text ?? "")}”` : undefined;
  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden p-2">
      <p className={`shrink-0 text-[14px] leading-5 font-semibold ${height >= 56 ? "line-clamp-2" : "truncate"}`}>{title}</p>
      {!compact && body && <p className="line-clamp-3 text-[14px] leading-5 whitespace-pre-wrap">{body}</p>}
      {!compact && !body && <p className="text-[12px] text-(--color-text-dim)">Tap to open</p>}
    </div>
  );
}
