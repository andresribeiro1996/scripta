import type { CSSProperties, ReactNode } from "react";
import { BookGrid } from "./BookGrid";
import { DEFAULT_LIBRARY_STYLE, type LibraryStyleSettings } from "../lib/libraryStyle";

/** Placeholder shapes shown while a page's data is in flight, in place
 *  of the dim "Loading…" line every page used to print.
 *
 *  The point isn't decoration. A one-line "Loading…" reserves one line,
 *  so when the data lands the whole page jumps and reflows — the single
 *  clearest tell of a page rather than an app. A skeleton in the shape of
 *  the content that's coming holds the layout still, and reads as
 *  faster even when it isn't.
 *
 *  Each shape below therefore mirrors a real grid rather than being a
 *  generic stack of bars — SkeletonBookGrid renders through the SAME
 *  BookGrid component the library uses, so the column count follows the
 *  user's own card-size setting and the placeholder cards land exactly
 *  where the real ones will.
 *
 *  Pair with useDelayedShow so a fast load draws nothing at all. */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-(--color-border) motion-reduce:animate-none ${className}`} style={style} />;
}

/** Wraps a set of placeholder shapes so assistive tech is told the page
 *  is working rather than reading out a pile of empty boxes. */
export function SkeletonScreen({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** Library, Series and Collections book grids. Cards are pure 2:3
 *  rectangles because a book card's title overlays its cover rather than
 *  sitting under it — there is no second line to stand in for. */
export function SkeletonBookGrid({ style = DEFAULT_LIBRARY_STYLE, count = 12 }: { style?: LibraryStyleSettings; count?: number }) {
  return (
    <SkeletonScreen label="Loading books">
      <BookGrid style={style}>
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className="aspect-[2/3] w-full rounded-lg" />
        ))}
      </BookGrid>
    </SkeletonScreen>
  );
}

/** The card grids on the murals, tournaments and tier-list lists. */
export function SkeletonCardGrid({
  count = 6,
  label = "Loading",
  tileClassName = "min-h-40",
  gridClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
}: {
  count?: number;
  label?: string;
  tileClassName?: string;
  gridClassName?: string;
}) {
  return (
    <SkeletonScreen label={label}>
      <div className={gridClassName}>
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className={`w-full rounded-xl ${tileClassName}`} />
        ))}
      </div>
    </SkeletonScreen>
  );
}

/** Series and Collections: each group is a bordered panel with its name
 *  on top and its books beneath, so the placeholder is drawn as panels
 *  rather than as loose cards. */
export function SkeletonGroups({ style = DEFAULT_LIBRARY_STYLE, count = 2 }: { style?: LibraryStyleSettings; count?: number }) {
  return (
    <SkeletonScreen label="Loading">
      <div className="flex flex-col gap-6">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <Skeleton className="mb-3 h-4 w-40" />
            <BookGrid style={style}>
              {Array.from({ length: 4 }, (_, j) => (
                <Skeleton key={j} className="aspect-[2/3] w-full rounded-lg" />
              ))}
            </BookGrid>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
