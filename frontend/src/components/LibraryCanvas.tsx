import type { ReactNode } from "react";
import type { LibraryStyleSettings } from "../lib/libraryStyle";

/** The area behind the books — and ONLY that area.
 *
 *  This is the "page" half of the Library style settings
 *  (backgroundColor + contentPaddingX/contentPaddingY, see
 *  lib/libraryStyle.ts) given a box of its own. Those used to be applied
 *  by PageContainer and by DashboardLayout's `<main>`, which meant a
 *  *library* setting styled the whole application shell: a custom
 *  background painted behind the page header, the search/filter toolbar,
 *  and every unrelated route (Settings, Library style, Gallery, Murals)
 *  — leaving the header's `--color-text` title stranded on an arbitrary
 *  user-picked color, the toolbar's `--color-surface` controls reading as
 *  floating chips, and the bottom tab bar cut off by a hard seam. Page
 *  padding had the same reach for the same reason.
 *
 *  So the boundary is drawn here instead: the app shell (sidebar, tab
 *  bar, page headers, toolbars, a series' name heading) is always
 *  theme-colored and always legible, and these settings govern the canvas
 *  the grid sits on. PageContainer keeps its own fixed, responsive
 *  padding — it is chrome, not canvas. Content WIDTH deliberately stayed
 *  on PageContainer rather than moving here; see its comment for why.
 *
 *  Rounded and clipped so a custom color reads as a deliberate panel
 *  rather than a leak. With no custom color set (`backgroundColor: null`)
 *  and the default zero padding, this renders as a plain transparent
 *  wrapper that changes nothing at all — which is what makes it safe to
 *  wrap every grid in unconditionally, and why the padding defaults are
 *  0 rather than the 20/32 they were as *page* padding (a non-zero
 *  default would indent the grid from the page header above it for every
 *  user who never opens these settings). */
export function LibraryCanvas({ style, children }: { style: LibraryStyleSettings; children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        backgroundColor: style.backgroundColor ?? undefined,
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
