// User-adjustable display settings — how the book grid looks (card size,
// spacing, corner rounding, border, shadow, hover animation, aspect
// ratio, overlay darkness, whether title/author show) and the canvas
// behind it (background color, content width, padding). Those last three
// are scoped to the books' own canvas, never the app shell — see
// components/LibraryCanvas.tsx. Lives on the
// library document (`data.style`, see api/library.ts) rather than
// localStorage: it's a per-account preference the user set deliberately,
// same reasoning as the library `name` (lib/groups.ts's Group and that
// field both went through the same "should this be server-side" call) —
// it should follow the account across browsers/devices, not reset on a
// new machine. Never touched by an importer, so it survives merges the
// same way `name` and `groups` do (see lib/merge.ts's mergeLibraryData).

export type CardAspectRatio = "2/3" | "3/4" | "1/1";
export type CardBorderStyle = "solid" | "dashed" | "dotted" | "double" | "groove" | "ridge";

/** A book card's title/author/status typeface — deliberately its OWN type,
 *  not shared with mural blocks' `BlockFontFamily` (lib/murals.ts's
 *  BlockStyle uses a separately-declared one, even though the option set
 *  happens to look the same) — the card and mural block style systems are
 *  independent by design (see BlockStyle's own comment for why: no shared
 *  runtime state, no priority-chain crossing between them), and keeping
 *  their types textually distinct too means a future change to one can
 *  never accidentally leak into the other through a shared alias. */
export type CardFontFamily = "sans" | "serif" | "mono" | "playfairDisplay" | "inter" | "jetbrainsMono";

export const CARD_FONT_FAMILY_OPTIONS: Array<{ value: CardFontFamily; label: string; css: string }> = [
  { value: "sans", label: "Sans-serif (system)", css: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { value: "serif", label: "Serif (system)", css: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" },
  { value: "mono", label: "Monospace (system)", css: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" },
  // Self-hosted (see index.css's own comment on the @font-face rules) —
  // real, distinctive typefaces rather than another OS-default look-alike.
  { value: "playfairDisplay", label: "Playfair Display", css: "'Playfair Display', ui-serif, Georgia, serif" },
  { value: "inter", label: "Inter", css: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  { value: "jetbrainsMono", label: "JetBrains Mono", css: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }
];

/** Resolves a CardFontFamily value to its real CSS `font-family` stack —
 *  used wherever a card's style is actually applied (BookCard.tsx), not
 *  by the picker itself. Falls back to the first option for any
 *  unrecognized value, same reasoning as blockFontFamilyCss below. */
export function cardFontFamilyCss(value: CardFontFamily): string {
  return CARD_FONT_FAMILY_OPTIONS.find((o) => o.value === value)?.css ?? CARD_FONT_FAMILY_OPTIONS[0].css;
}

export const CARD_FONT_SIZE_RANGE = { min: 9, max: 20, step: 1 };

/** Which sides actually draw a border — independent of `cardBorderWidth`,
 *  which stays a single value shared by whichever sides are on (a
 *  per-side *width* would be a lot of extra sliders for a case nobody
 *  asked for; per-side *presence* is what "can I say if there's a border
 *  left/right/etc" actually meant). */
export interface BorderSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export const DEFAULT_BORDER_SIDES: BorderSides = { top: true, right: true, bottom: true, left: true };

export interface LibraryStyleSettings {
  // --- Card layout ---
  /** Minimum card width in px — the grid is `repeat(auto-fill,
   *  minmax(cardMinWidth, 1fr))`, so this is effectively "how big are the
   *  cards" while staying responsive without needing separate breakpoint
   *  tiers per screen size. */
  cardMinWidth: number;
  /** Horizontal gap between cards in the same row, in px — CSS
   *  `column-gap`. */
  cardGap: number;
  /** Vertical gap between rows of cards, in px — CSS `row-gap`. Separate
   *  from `cardGap` since a compact horizontal spacing with generous
   *  breathing room between rows (or vice versa) is a reasonable thing to
   *  want, and a single `gap` shorthand can't express that. */
  rowGap: number;
  /** Cover shape — CSS `aspect-ratio` value directly (e.g. "2/3"). */
  cardAspectRatio: CardAspectRatio;

  // --- Card appearance ---
  /** Card corner rounding, in px. */
  cardRadius: number;
  /** Card border width, in px. `0` means no border at all. */
  cardBorderWidth: number;
  /** Card border color. `null` means "use the theme default"
   *  (--color-border) — only meaningful when `cardBorderWidth > 0`. */
  cardBorderColor: string | null;
  /** CSS `border-style` — only meaningful when `cardBorderWidth > 0`.
   *  `groove`/`ridge` need at least a couple px of width to actually read
   *  as anything other than a flat line, same as plain CSS. */
  cardBorderStyle: CardBorderStyle;
  /** Border opacity, 0–100 — independent of `cardBorderColor` itself so a
   *  chosen color can be faded without having to re-pick it. 100 = fully
   *  opaque (the plain color/CSS-var, no math). Applied via `rgba()` for
   *  an explicit color, or CSS `color-mix()` for the theme-default color
   *  — see BookCard.tsx's `resolveBorderColor()`. */
  cardBorderOpacity: number;
  /** Which of the 4 sides actually draw the border. */
  cardBorderSides: BorderSides;
  /** Card opacity, 0–100 — the whole card (cover, text, everything),
   *  distinct from `cardBorderOpacity`. Lets the page background (see
   *  `backgroundColor` below) show through. */
  cardOpacity: number;
  /** Whether cards get a drop shadow (`shadow-sm`). */
  cardShadow: boolean;
  /** Whether cards lift/scale and their shadow deepens on hover. */
  cardHoverEffect: boolean;
  /** Strength (0–100) of the dark gradient scrim behind the title/author
   *  overlay text — higher means darker/more legible text but more of
   *  the cover art obscured at the bottom. Only rendered at all when the
   *  overlay text itself is showing (see `showTitleAuthor` and
   *  BookCard.tsx's `showOverlayText`). */
  overlayIntensity: number;
  /** Whether to show the title/author overlay on cards that DO have a
   *  resolved cover image. Books with no cover (BookCard's icon-only
   *  fallback panel) always show title/author regardless of this — with
   *  no image, hiding the text would leave a card with nothing on it at
   *  all, defeating the point of a library view. See BookCard.tsx's
   *  `hasCover` state for where that's enforced. */
  showTitleAuthor: boolean;
  /** The title/author/status overlay text's typeface. */
  cardFontFamily: CardFontFamily;
  /** The overlay text's BASE size, in px — title/author/status are each
   *  sized in `em` relative to this (see BookCard.tsx), not Tailwind's
   *  rem-based text-* utilities, which measure against the document root
   *  and wouldn't respond to this at all. */
  cardFontSize: number;
  /** CSS color for the overlay text. `null` means white — BookCard's
   *  original hardcoded color, kept as the default because this text
   *  always sits on a dark scrim over the cover art, regardless of the
   *  app's own light/dark theme. NOT the same "null means the app's
   *  --color-text" meaning a `textColor` field has elsewhere (e.g. mural
   *  blocks' BlockStyle) — deliberately different defaults for a
   *  deliberately different context. */
  cardTextColor: string | null;
  /** Bold the overlay text (title/author/status). Only one weight is
   *  actually downloaded per self-hosted family (see index.css) — this
   *  renders via the browser's own synthesized bold rather than a second
   *  font file, same as `cardItalic` uses synthesized oblique. */
  cardBold: boolean;
  /** Italicize the overlay text. */
  cardItalic: boolean;

  // --- Library canvas (the area behind the cards) ---
  //
  // These three are scoped to the book grid's own canvas, NOT to the
  // application shell — see components/LibraryCanvas.tsx for where that
  // line is drawn and why it moved there.
  /** CSS color for the canvas behind the book grid. `null` means "no
   *  override" — the canvas stays transparent and the app's own theme
   *  background (--color-bg) shows through. Deliberately does NOT reach
   *  the page header, the search/filter toolbar, the nav, or any route
   *  without a book grid. */
  backgroundColor: string | null;
  /** Max width of the page content (the grid AND the header above it),
   *  in px — applied by PageContainer, the one style field that stays
   *  there, since a grid and its header have to share a width or they
   *  visibly stop lining up. */
  contentMaxWidth: number;
  /** Horizontal padding INSIDE the canvas, in px — the gap between a
   *  custom background's edge and the cards. Not page padding: it can't
   *  move the app's own headers or menus. */
  contentPaddingX: number;
  /** Vertical padding inside the canvas, in px. */
  contentPaddingY: number;
}

export const DEFAULT_LIBRARY_STYLE: LibraryStyleSettings = {
  cardMinWidth: 200,
  cardGap: 16,
  rowGap: 16,
  cardAspectRatio: "2/3",
  cardRadius: 16, // matches the old hardcoded `rounded-2xl` (1rem) BookCard used before this setting existed
  cardBorderWidth: 0,
  cardBorderColor: null,
  cardBorderStyle: "solid",
  cardBorderOpacity: 100,
  cardBorderSides: DEFAULT_BORDER_SIDES,
  cardOpacity: 100,
  cardShadow: true,
  cardHoverEffect: true,
  overlayIntensity: 88, // matches the old hardcoded peak scrim opacity (0.88) BookCard used before this setting existed
  showTitleAuthor: true,
  cardFontFamily: "sans",
  cardFontSize: 13, // roughly matches the overlay text sizes hardcoded before this setting existed (title 15px ≈ 13 × 1.15em)
  cardTextColor: null,
  cardBold: false,
  cardItalic: false,
  backgroundColor: null,
  contentMaxWidth: 1152, // matches PageContainer's own default width (72rem)
  // 0, not the 20/32 these were when they applied to the whole PAGE.
  // They now pad the book canvas INSIDE PageContainer's own padding
  // (see LibraryCanvas), so any non-zero default would indent the grid
  // from the page header sitting right above it — for every user who
  // never opens these settings. At 0 with no custom background the
  // canvas is completely invisible, which is the correct default; the
  // padding becomes worth reaching for once a background color makes
  // the panel's edges visible.
  contentPaddingX: 0,
  contentPaddingY: 0
};

// min: 40, not the original 120 — the old floor topped out at 2 columns
// on a phone (a ~328px canvas fits 2×120 and not 3), which is exactly
// the ceiling this range exists to lift. 40 clears PHONE_MIN_COLUMNS
// with headroom: at the default 16px gap a 360px phone fits 6 columns,
// so 5 is comfortably reachable rather than only just. 200 (the default)
// still lands on the step grid from `min`, which
// scripts/test-library-style.mts asserts for every numeric default.
export const CARD_MIN_WIDTH_RANGE = { min: 40, max: 320, step: 10 };
export const CARD_GAP_RANGE = { min: 0, max: 32, step: 2 };
export const CARD_RADIUS_RANGE = { min: 0, max: 32, step: 2 };
export const CARD_BORDER_WIDTH_RANGE = { min: 0, max: 6, step: 1 };
export const CARD_BORDER_OPACITY_RANGE = { min: 0, max: 100, step: 4 };
export const CARD_OPACITY_RANGE = { min: 0, max: 100, step: 4 };
export const CARD_BORDER_STYLE_OPTIONS: Array<{ value: CardBorderStyle; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "double", label: "Double" },
  { value: "groove", label: "Groove" },
  { value: "ridge", label: "Ridge" }
];
// step: 2, not 5 — the default (88) has to actually sit on the grid, or
// range inputs silently snap it to the nearest step (90) the moment
// they're touched, diverging from what's documented as the default.
export const OVERLAY_INTENSITY_RANGE = { min: 0, max: 100, step: 2 };
// step: 16, not 20 — same reasoning as OVERLAY_INTENSITY_RANGE above: the
// default (1152) has to land exactly on the step grid from `min`.
export const CONTENT_MAX_WIDTH_RANGE = { min: 800, max: 1800, step: 16 };
export const CONTENT_PADDING_RANGE = { min: 0, max: 64, step: 4 };
export const CARD_ASPECT_RATIO_OPTIONS: Array<{ value: CardAspectRatio; label: string }> = [
  { value: "2/3", label: "Poster (2:3)" },
  { value: "3/4", label: "Portrait (3:4)" },
  { value: "1/1", label: "Square (1:1)" }
];

/** Fills in defaults for anything unset — a library saved before this
 *  feature existed (or one with a partially-applied style, if the shape
 *  ever grows a field) has no `style` at all, or an incomplete one. */
export function resolveLibraryStyle(style: Partial<LibraryStyleSettings> | undefined): LibraryStyleSettings {
  return { ...DEFAULT_LIBRARY_STYLE, ...style };
}

// --- Per-series style overrides (see lib/groups.ts's Group.style) ---
//
// A series can override how its own cards look, taking priority over the
// library-wide style. Scoped to appearance/border/content only — layout
// (cardMinWidth/cardGap/rowGap) and page (background/width/padding) stay
// library-wide, on purpose: every card in the Library grid shares one CSS
// grid, so column sizing/gaps can't meaningfully vary per series without
// splitting the grid itself; per-card properties (border, shadow,
// opacity, ...) have no such constraint — each BookCard is styled
// independently regardless of the shared grid it sits in.

export const PER_CARD_STYLE_KEYS = [
  "cardRadius",
  "cardAspectRatio",
  "cardBorderWidth",
  "cardBorderStyle",
  "cardBorderColor",
  "cardBorderOpacity",
  "cardBorderSides",
  "cardOpacity",
  "cardShadow",
  "cardHoverEffect",
  "overlayIntensity",
  "showTitleAuthor",
  "cardFontFamily",
  "cardFontSize",
  "cardTextColor",
  "cardBold",
  "cardItalic"
] as const;

export type PerCardStyle = Pick<LibraryStyleSettings, (typeof PER_CARD_STYLE_KEYS)[number]>;

/** Pulls just the per-card-overridable fields out of a full style — used
 *  to seed a series' override draft from the library's current effective
 *  values when a user turns customization on for the first time. */
export function extractPerCardStyle(style: LibraryStyleSettings): PerCardStyle {
  const result = {} as PerCardStyle;
  for (const key of PER_CARD_STYLE_KEYS) {
    (result as Record<string, unknown>)[key] = style[key];
  }
  return result;
}

const DEFAULT_PER_CARD_STYLE: PerCardStyle = extractPerCardStyle(DEFAULT_LIBRARY_STYLE);

/** Fills in defaults for anything missing — same reasoning as
 *  resolveLibraryStyle(), one level down: a `Group.style` should always
 *  be either `undefined` or a complete `PerCardStyle`, but nothing
 *  actually *enforces* that (hand-edited data, or a bug — an earlier
 *  version of SeriesStylePanel's patch handling briefly did save partial
 *  objects) shouldn't crash whatever renders it. Every reader of
 *  `Group.style` should go through this rather than trusting the field
 *  directly. */
export function resolvePerCardStyle(style: Partial<PerCardStyle> | undefined): PerCardStyle {
  return { ...DEFAULT_PER_CARD_STYLE, ...style };
}

/** The style a single card actually renders with — three priority levels,
 *  each optional, each winning field-by-field over everything before it:
 *  the library-wide style, then a series' own override (if the book is in
 *  one and it's customized), then the BOOK's own override (if it has one
 *  — see `book._style`, BookCard.tsx's "Style" button). Layout/page
 *  fields always come from `libraryStyle` regardless of either override,
 *  since neither can contain them (see `PerCardStyle`'s type).
 *
 *  Each override, when present, is resolved through resolvePerCardStyle()
 *  before merging rather than trusted directly — both `Group.style` and a
 *  book's `_style` are supposed to always be a complete object once set,
 *  but nothing enforces that at rest (hand-edited data, or a past bug —
 *  see this file's own history), so every real reader goes through here. */
export function effectiveCardStyle(
  libraryStyle: LibraryStyleSettings,
  seriesOverride: Partial<PerCardStyle> | undefined,
  bookOverride?: Partial<PerCardStyle> | undefined
): LibraryStyleSettings {
  let result = libraryStyle;
  if (seriesOverride) result = { ...result, ...resolvePerCardStyle(seriesOverride) };
  if (bookOverride) result = { ...result, ...resolvePerCardStyle(bookOverride) };
  return result;
}

// --- Mural block style (see lib/murals.ts's MuralBlock.style) ---
//
// Every mural block (components/murals/BlockStylePanel.tsx, opened from
// its own "Style" button on MuralCanvas.tsx — a separate control from the
// gear icon's content config, same Style-vs-Cover split BookCard.tsx
// already has) can have its own appearance — background, radius, border,
// shadow, hover, font, size, text color.
//
// ISOLATED from the book/library/series style system on purpose (its own
// requirement, not incidental): `BlockStyle` below shares NO type
// relationship with `PerCardStyle`/`LibraryStyleSettings` — no `Omit`, no
// intersection, no imported reference either direction. A mural block's
// look, and a book card's look, are two genuinely independent things a
// user configures separately; neither should be able to change just
// because the other's shape changed. The two DO happen to look similar in
// places (both have a font/size/color trio, both reuse CardBorderSection
// for their border controls) because the same UI patterns make sense
// twice, not because one is built out of the other — see BlockStyle's own
// comment for exactly how that UI-component reuse works without any
// actual type coupling.
//
// Also unlike PerCardStyle, there's no priority-chain resolution here
// (library → series → book): there's nothing above a mural block for it
// to inherit from or take priority over, so this is edited directly,
// always-on, no "customize?" toggle needed.

/** A small, system-font-stack-only set — no webfont loading (no network
 *  dependency, works offline, matches this app's self-hosted-personal-app
 *  posture) — three genuinely different *looks* (geometric/humanist sans,
 *  a serif for a more literary feel, monospace for a "typewriter note"
 *  feel) rather than a long list of near-identical sans choices. */
export type BlockFontFamily = "sans" | "serif" | "mono" | "playfairDisplay" | "inter" | "jetbrainsMono";

export const BLOCK_FONT_FAMILY_OPTIONS: Array<{ value: BlockFontFamily; label: string; css: string }> = [
  { value: "sans", label: "Sans-serif (system)", css: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { value: "serif", label: "Serif (system)", css: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" },
  { value: "mono", label: "Monospace (system)", css: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" },
  // Self-hosted (see index.css) — same three as CardFontFamily's own
  // additions, duplicated rather than shared, per this file's isolation
  // rule (see BlockStyle's own comment below).
  { value: "playfairDisplay", label: "Playfair Display", css: "'Playfair Display', ui-serif, Georgia, serif" },
  { value: "inter", label: "Inter", css: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  { value: "jetbrainsMono", label: "JetBrains Mono", css: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" }
];

/** Resolves a BlockFontFamily value to its real CSS `font-family` stack —
 *  used wherever a block's style is actually applied (MuralCanvas.tsx),
 *  not by the picker itself (StyleControls.tsx's select just stores the
 *  short key). Falls back to the first option for any unrecognized value
 *  (hand-edited data, a future removed option) rather than rendering with
 *  no font-family at all. */
export function blockFontFamilyCss(value: BlockFontFamily): string {
  return BLOCK_FONT_FAMILY_OPTIONS.find((o) => o.value === value)?.css ?? BLOCK_FONT_FAMILY_OPTIONS[0].css;
}

export const BLOCK_FONT_SIZE_RANGE = { min: 10, max: 24, step: 1 };

/** A FULLY INDEPENDENT type — deliberately NOT `Omit<PerCardStyle, ...> &
 *  {...}` (an earlier version of this file did derive it that way, and it
 *  was a real bug waiting to happen: the moment PerCardStyle grew its own
 *  `cardFontFamily`/`cardFontSize`/`cardTextColor` fields, BlockStyle
 *  silently inherited them too via the Omit, which never excluded them —
 *  exactly the accidental coupling isolation is supposed to prevent).
 *  The border fields below (`cardBorderWidth` etc.) share PerCardStyle's
 *  field NAMES and TYPES on purpose, purely so CardBorderSection
 *  (StyleControls.tsx) works for a block's style unmodified via ordinary
 *  structural typing — that's a UI-component-reuse convenience, not a
 *  type relationship; nothing here imports or references PerCardStyle,
 *  so a future change to one can never silently reach the other again. */
export type BlockStyle = {
  /** CSS color for the block's own background — `null` means "use the
   *  theme default" (--color-surface). A BookCard has no equivalent
   *  setting since its background IS the cover art; a mural block has no
   *  cover art of its own, so this is a genuinely new field here. */
  backgroundColor: string | null;
  /** The block's typeface — see BlockFontFamily above. */
  fontFamily: BlockFontFamily;
  /** The block's BASE text size, in px — applied to the block wrapper
   *  itself (MuralCanvas.tsx), with every text element inside a block
   *  view (components/murals/blocks/*.tsx) sized in `em` relative to it
   *  (never Tailwind's rem-based text-* utilities, which measure against
   *  the document root and so wouldn't respond to this at all) — a
   *  heading might be `1.1em`, a caption `0.8em`, but they all move
   *  together as this changes. */
  fontSize: number;
  /** CSS color for the block's PRIMARY text — `null` means "use the
   *  theme default" (--color-text). Secondary/meta text (captions,
   *  attributions, dimmed labels) intentionally keeps its own muted color
   *  regardless of this setting, same reasoning a BookCard's highlight
   *  badge stays accent-colored regardless of anything else — some text
   *  is decoration/chrome, not the content this setting is about. */
  textColor: string | null;
  /** Bold the block's text. Renders via the browser's own synthesized
   *  bold — only one weight is actually downloaded per self-hosted
   *  family (see index.css), same reasoning as PerCardStyle's
   *  `cardBold`. */
  bold: boolean;
  /** Italicize the block's text. */
  italic: boolean;
  /** Forces the block's text to render in a monospace face regardless of
   *  `fontFamily` — the "code" style. Deliberately BlockStyle-only, not
   *  added to PerCardStyle: a book's title/author overlay is short
   *  metadata, "make it look like code" has no real use there, whereas a
   *  mural's Text/Quote blocks are actual freeform prose where someone
   *  legitimately might want a snippet or quote to read as code (a
   *  markdown-style "inline code" mark, which always renders monospace
   *  regardless of the surrounding body font — same idea, applied at the
   *  block level rather than per character since there's no rich-text
   *  editor here to select a run of text within a block). */
  codeStyle: boolean;
  cardRadius: number;
  cardBorderWidth: number;
  cardBorderColor: string | null;
  cardBorderStyle: CardBorderStyle;
  cardBorderOpacity: number;
  cardBorderSides: BorderSides;
  cardOpacity: number;
  cardShadow: boolean;
  cardHoverEffect: boolean;
};

export const DEFAULT_BLOCK_STYLE: BlockStyle = {
  backgroundColor: null,
  fontFamily: "sans",
  fontSize: 14, // roughly matches the block text sizes hardcoded before this setting existed
  textColor: null,
  bold: false,
  italic: false,
  codeStyle: false,
  cardRadius: 12, // matches the mural block wrapper's old hardcoded `rounded-xl`
  cardBorderWidth: 1, // matches the old hardcoded `border border-(--color-border)`
  cardBorderColor: null,
  cardBorderStyle: "solid",
  cardBorderOpacity: 100,
  cardBorderSides: DEFAULT_BORDER_SIDES,
  cardOpacity: 100,
  cardShadow: true, // matches the old hardcoded `shadow-sm`
  cardHoverEffect: false // a mural block isn't a clickable navigational element the way a BookCard is — off by default, unlike PerCardStyle's
};

/** Same "fill in whatever's missing" reasoning as resolvePerCardStyle(). */
export function resolveBlockStyle(style: Partial<BlockStyle> | undefined): BlockStyle {
  return { ...DEFAULT_BLOCK_STYLE, ...style };
}

/** Applies `cardBorderOpacity` on top of `cardBorderColor` — kept as two
 *  independent settings so a chosen color can be faded without re-picking
 *  it, and so the theme-default border still has an opacity knob even
 *  though there's no literal color value to fade (`color-mix()` handles
 *  that case; an explicit hex color converts to `rgba()` instead, since
 *  `<input type="color">` itself can't carry alpha). Opacity 100 skips
 *  the math entirely — returns the plain color/CSS-var, unchanged. Used
 *  by BookCard.tsx's border and directly unit-tested (see
 *  scripts/test-library-style.mts) since it's the one non-trivial bit of
 *  string math in this whole settings feature. */
export function resolveBorderColor(color: string | null, opacityPercent: number): string {
  if (opacityPercent >= 100) return color ?? "var(--color-border)";
  if (!color) return `color-mix(in srgb, var(--color-border) ${opacityPercent}%, transparent)`;
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return color; // not a hex color we can parse — fall back as-is
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacityPercent / 100})`;
}

/** Overlay text tiers, by the card's REAL rendered width.
 *
 *  A card's width comes from the grid's `1fr` tracks, not from
 *  `cardMinWidth` — the same setting yields very different widths
 *  depending on how much room the row had left over — so only the card
 *  itself knows which tier it's in. That's why these are enforced by CSS
 *  container queries (see index.css's `.book-card` rules and
 *  BookCard.tsx's `containerType`) rather than by a media query or a
 *  check against the setting.
 *
 *  Below COMPACT the overlay tightens its padding, drops a step in size
 *  and shows the title alone — deliberately NOT a hard cut to nothing,
 *  because a phone at a large card size lands right around here and a
 *  title is exactly what's wanted there.
 *
 *  Below MIN the overlay goes entirely: at that width even one line of
 *  the title is a few illegible pixels smeared over the artwork, and a
 *  plain cover tile is the honest rendering. */
export const CARD_OVERLAY_TEXT_MIN_WIDTH = 88;
export const CARD_OVERLAY_COMPACT_WIDTH = 132;

/** The number of columns a phone shows AT THE DEFAULT card size.
 *
 *  One `cardMinWidth` serves every screen, and a desktop-tuned value —
 *  the 200px default included — is wider than half a phone, so
 *  `auto-fill` resolved it to a SINGLE full-bleed card per row: one
 *  cover filled the viewport and the library became unbrowsable.
 *
 *  The phone rule (index.css, behind a max-width query) scales the
 *  column floor so that the DEFAULT card size lands on exactly this many
 *  columns, and every other setting scales in proportion. It is
 *  deliberately NOT a hard `min()` cap, which is what an earlier version
 *  did: that pinned phone cards at ~53px whatever the slider said, so
 *  the setting was inert on phones AND the card could never reach a
 *  width where its title was legible. Scaling keeps the slider
 *  meaningful — larger settings really do give a phone bigger cards and
 *  fewer columns, right up to a title-sized card.
 *
 *  The floor never drops below CARD_MIN_WIDTH_RANGE.min, so the smallest
 *  settings converge rather than scaling down to a few unusable pixels.
 *
 *  Confined to phone widths on purpose. Applied unconditionally it would
 *  also fire on a tablet and on a desktop whose `contentMaxWidth` the
 *  user deliberately narrowed — and people narrow that precisely BECAUSE
 *  they want large cards in a narrow column, so overriding it would swap
 *  one wrong-card-size bug for another. */
export const PHONE_COLUMNS_AT_DEFAULT_SIZE = 5;

/** The width below which PHONE_COLUMNS_AT_DEFAULT_SIZE applies —
 *  Tailwind's `sm` breakpoint, the same line the page header and toolbar
 *  switch on, so the grid never changes shape at a width where nothing
 *  else does. Kept in sync by hand with the `@media` query in index.css;
 *  CSS can't read a TS constant, and the alternative (a <style> tag
 *  rendered per grid) would spend a style element on a number that never
 *  varies at runtime. */
export const PHONE_GRID_BREAKPOINT = 640;

