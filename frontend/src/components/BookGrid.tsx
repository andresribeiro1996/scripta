import type { ReactNode } from "react";
import type { LibraryStyleSettings } from "../lib/libraryStyle";
import { gridColumnsCss } from "../lib/libraryStyle";

/** Shared grid wrapper for every book-card grid in the app (Library,
 *  Series, Collections) so they all respect the same user-configured
 *  style (see /dashboard/style, lib/libraryStyle.ts) rather than each
 *  page hardcoding its own Tailwind breakpoint tiers. `auto-fill` with a
 *  `minmax` floor gives responsive columns "for free" from a single
 *  "how big are the cards" number, instead of needing a separate
 *  sm/md/lg column count tuned to match. */
export function BookGrid({ style, children }: { style: LibraryStyleSettings; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${gridColumnsCss(style.cardMinWidth)}, 1fr))`,
        columnGap: `${style.cardGap}px`,
        rowGap: `${style.rowGap}px`
      }}
    >
      {children}
    </div>
  );
}
