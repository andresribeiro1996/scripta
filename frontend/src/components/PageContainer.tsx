import type { ReactNode } from "react";
import type { LibraryStyleSettings } from "../lib/libraryStyle";

/** Shared page wrapper for the three pages that show book grids (Library,
 *  Series, Collections) — the "environment around" the cards, sized per
 *  the user's own Library style settings (contentMaxWidth/contentPaddingX/
 *  contentPaddingY) instead of a hardcoded Tailwind `max-w-6xl px-5 py-8`.
 *  Not used by Settings/Library style themselves — those aren't
 *  book-card pages. */
export function PageContainer({ style, children }: { style: LibraryStyleSettings; children: ReactNode }) {
  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: `${style.contentMaxWidth}px`,
        paddingLeft: `${style.contentPaddingX}px`,
        paddingRight: `${style.contentPaddingX}px`,
        paddingTop: `${style.contentPaddingY}px`,
        paddingBottom: `${style.contentPaddingY}px`
      }}
    >
      {children}
    </div>
  );
}
