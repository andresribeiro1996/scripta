// The nav's icon family. Same rules as Toolbar.tsx's control icons (see
// the convention comment there): drawn SVG on a 24×24 viewBox, stroked
// with currentColor at width 2, round caps and joins — never a Unicode
// glyph, which sits off-centre in its own cell and can't inherit weight.
//
// Separate from Toolbar.tsx because these are a different family with a
// different job. Control icons sit at 16-18px inside a 44px button and
// are read alongside a label that's already on screen; these are 18-22px
// and, in the bottom tab bar, carry the meaning almost on their own. A
// `size` prop rather than fixed dimensions, because the same glyph
// appears at 22 in the tab bar and 18 in the sidebar and drawer.
//
// They're also deliberately distinguishable from each other at 22px on a
// phone, which is a stronger constraint than looking good at 64px:
// Library and Series are both books, so one is an open book and the
// other a shelf of spines; Gallery and Murals are both framed
// rectangles, so only Gallery carries the sun-and-hills image mark.

interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
}

/** An open book — the library itself. */
export function LibraryIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 7v12.5" />
      <path d="M12 7c-1.5-1.6-3.6-2.2-8-2.2v12.9c4.4 0 6.5.6 8 2.2" />
      <path d="M12 7c1.5-1.6 3.6-2.2 8-2.2v12.9c-4.4 0-6.5.6-8 2.2" />
    </svg>
  );
}

/** Spines on a shelf — books that run in sequence. */
export function SeriesIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3.5" y="6.5" width="4" height="13" rx="1" />
      <rect x="9.5" y="4.5" width="4" height="15" rx="1" />
      <path d="M16.4 7.4l3.4.9-3 11.1-3.4-.9z" />
    </svg>
  );
}

/** Stacked plates — sets grouped on top of one another. */
export function CollectionsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 3.5 21 8l-9 4.5L3 8z" />
      <path d="M3.5 12.2 12 16.5l8.5-4.3" />
      <path d="M3.5 16.2 12 20.5l8.5-4.3" />
    </svg>
  );
}

/** A framed picture with sun and hills — the image gallery. */
export function GalleryIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.7" />
      <path d="M4.2 16.8 9 12.5l2.8 2.6L15.4 11l5.1 5" />
    </svg>
  );
}

/** Panes at different sizes — the freeform canvas. Frame only, no image
 *  mark, so it never reads as the Gallery. */
export function MuralsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M10.5 5v14" />
      <path d="M10.5 12.2h10" />
    </svg>
  );
}

/** A trophy — bracket tournaments. */
export function ArenaIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M7.5 4.5h9v4.6a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H5.2a3 3 0 0 0 3 3.2" />
      <path d="M16.5 6h2.3a3 3 0 0 1-3 3.2" />
      <path d="M12 13.6v3.4" />
      <path d="M8.6 19.5h6.8" />
    </svg>
  );
}

/** A cog — settings. Toolbar.tsx's GearIcon carries the same mark (they
 *  must: it is the one settings glyph in the app), redrawn there from
 *  hub-and-spokes for the same reason. Radial ticks around a circle read
 *  as a brightness/sun mark at any size — teeth have to sit ON the
 *  silhouette for the eye to call it a gear. */
export function SettingsIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M 9.87 5.65 L 10.21 3.18 L 13.79 3.18 L 14.13 5.65 A 6.7 6.7 0 0 1 14.99 6.00 L 16.97 4.50 L 19.50 7.03 L 18.00 9.01 A 6.7 6.7 0 0 1 18.35 9.87 L 20.82 10.21 L 20.82 13.79 L 18.35 14.13 A 6.7 6.7 0 0 1 18.00 14.99 L 19.50 16.97 L 16.97 19.50 L 14.99 18.00 A 6.7 6.7 0 0 1 14.13 18.35 L 13.79 20.82 L 10.21 20.82 L 9.87 18.35 A 6.7 6.7 0 0 1 9.01 18.00 L 7.03 19.50 L 4.50 16.97 L 6.00 14.99 A 6.7 6.7 0 0 1 5.65 14.13 L 3.18 13.79 L 3.18 10.21 L 5.65 9.87 A 6.7 6.7 0 0 1 6.00 9.01 L 4.50 7.03 L 7.03 4.50 L 9.01 6.00 A 6.7 6.7 0 0 1 9.87 5.65 Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}

/** Three dots — everything not on the tab bar. */
export function MoreIcon({ size = 22 }: IconProps) {
  return (
    <svg {...svgProps(size)} fill="currentColor" stroke="none">
      <circle cx="5.2" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.8" cy="12" r="1.7" />
    </svg>
  );
}
