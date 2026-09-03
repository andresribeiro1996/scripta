import type { ReactNode } from "react";
import { DEFAULT_LIBRARY_STYLE } from "../lib/libraryStyle";

/** Shared page wrapper for every signed-in dashboard page — the app's own
 *  chrome: it holds the page header, any toolbars, and the content below
 *  them.
 *
 *  Its PADDING is deliberately fixed and responsive, no longer the
 *  Library style's contentPaddingX/contentPaddingY. Those used to be
 *  applied here, which let a *library* setting push the app's own page
 *  headers and toolbars around — and applied them to pages with no book
 *  grid at all (Gallery, Murals). Padding and background now belong to
 *  LibraryCanvas, which wraps only the book grid; see its comment for the
 *  full boundary.
 *
 *  `maxWidth` is the one style field that legitimately stays here, and
 *  only for the pages that opt in by passing it. Width is a page-layout
 *  concern rather than a canvas one: if the grid may run to 1800px, the
 *  header above it has to run to 1800px too or the two visibly stop
 *  lining up. Putting it on the canvas instead would have capped the grid
 *  at whatever this container already was, quietly turning a setting that
 *  could widen the page into one that could only narrow it. Pages with no
 *  book grid (Gallery, Murals) simply don't pass it and keep the default.
 *
 *  The padding steps down below `sm` because vertical space is the
 *  scarcest thing on a phone: the desktop `py-8` spent about a tenth of a
 *  phone viewport above the first row of covers. */
export function PageContainer({ maxWidth, children }: { maxWidth?: number; children: ReactNode }) {
  return (
    <div className="mx-auto px-4 py-5 sm:px-5 sm:py-8" style={{ maxWidth: `${maxWidth ?? DEFAULT_LIBRARY_STYLE.contentMaxWidth}px` }}>
      {children}
    </div>
  );
}
