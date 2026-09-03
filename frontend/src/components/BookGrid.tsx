import type { CSSProperties, ReactNode } from "react";
import { CARD_MIN_WIDTH_RANGE, DEFAULT_LIBRARY_STYLE, type LibraryStyleSettings } from "../lib/libraryStyle";

/** Shared grid wrapper for every book-card grid in the app (Library,
 *  Series, Collections) so they all respect the same user-configured
 *  style (see /dashboard/style, lib/libraryStyle.ts) rather than each
 *  page hardcoding its own Tailwind breakpoint tiers. `auto-fill` with a
 *  `minmax` floor gives responsive columns "for free" from a single
 *  "how big are the cards" number, instead of needing a separate
 *  sm/md/lg column count tuned to match.
 *
 *  The actual `grid-template-columns` lives in index.css's `.book-grid`,
 *  not here, and this passes the two numbers it needs in as custom
 *  properties. That's forced by PHONE_MIN_COLUMNS (see its comment in
 *  lib/libraryStyle.ts): the phone column cap has to apply only below
 *  `sm`, an inline style can't hold a media query, and the same cap
 *  applied unconditionally would misfire on a narrowed desktop content
 *  area. The gap is passed as a variable as well as being applied as
 *  `column-gap` because the cap has to subtract the gaps a phone row
 *  will spend, or the guaranteed column count is off by exactly those
 *  pixels. */
export function BookGrid({ style, children }: { style: LibraryStyleSettings; children: ReactNode }) {
  return (
    <div
      className="book-grid"
      style={
        {
          "--card-floor": `${style.cardMinWidth}px`,
          "--card-gap": `${style.cardGap}px`,
          // UNITLESS on purpose, and computed here rather than in CSS.
          // The phone rule needs to scale a length by "how far from the
          // default is this setting", and `calc(<length> * <length>)` is
          // invalid CSS — the whole declaration gets dropped and phones
          // silently fall back to one full-bleed column, which is the
          // exact bug the phone rule exists to fix. A plain number is a
          // valid calc multiplier, and computing it here also keeps the
          // default card size a TS constant instead of a literal
          // repeated in the stylesheet.
          "--card-scale": String(style.cardMinWidth / DEFAULT_LIBRARY_STYLE.cardMinWidth),
          "--card-floor-min": `${CARD_MIN_WIDTH_RANGE.min}px`,
          columnGap: `${style.cardGap}px`,
          rowGap: `${style.rowGap}px`
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
