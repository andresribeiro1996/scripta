// Exercises lib/libraryStyle.ts — mainly a guard against a real bug found
// while building /dashboard/style: a default value that doesn't sit
// exactly on its slider's step grid (from `min`, in multiples of `step`)
// gets silently snapped by the browser's native <input type="range"> the
// moment it renders — so the value actually shown/saved on first render
// diverges from DEFAULT_LIBRARY_STYLE. Caught for `overlayIntensity` (88
// vs. step 5) and `contentMaxWidth` (1152 vs. step 20); this makes sure
// neither regresses and that nothing else new is off-grid either. Run
// with:
//   npx tsx scripts/test-library-style.mts

import {
  BLOCK_FONT_FAMILY_OPTIONS,
  BLOCK_FONT_SIZE_RANGE,
  CARD_BORDER_OPACITY_RANGE,
  CARD_BORDER_WIDTH_RANGE,
  CARD_FONT_FAMILY_OPTIONS,
  CARD_FONT_SIZE_RANGE,
  CARD_GAP_RANGE,
  CARD_MIN_WIDTH_RANGE,
  CARD_OPACITY_RANGE,
  CARD_RADIUS_RANGE,
  CONTENT_MAX_WIDTH_RANGE,
  CONTENT_PADDING_RANGE,
  DEFAULT_BLOCK_STYLE,
  DEFAULT_LIBRARY_STYLE,
  OVERLAY_INTENSITY_RANGE,
  PER_CARD_STYLE_KEYS,
  blockFontFamilyCss,
  cardFontFamilyCss,
  effectiveCardStyle,
  extractPerCardStyle,
  resolveBlockStyle,
  resolveBorderColor,
  resolveLibraryStyle,
  resolvePerCardStyle
} from "../src/lib/libraryStyle";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("1. Every numeric default sits exactly on its slider's step grid");
{
  const pairs: Array<[string, number, { min: number; max: number; step: number }]> = [
    ["cardMinWidth", DEFAULT_LIBRARY_STYLE.cardMinWidth, CARD_MIN_WIDTH_RANGE],
    ["cardGap", DEFAULT_LIBRARY_STYLE.cardGap, CARD_GAP_RANGE],
    ["rowGap", DEFAULT_LIBRARY_STYLE.rowGap, CARD_GAP_RANGE],
    ["cardRadius", DEFAULT_LIBRARY_STYLE.cardRadius, CARD_RADIUS_RANGE],
    ["cardBorderWidth", DEFAULT_LIBRARY_STYLE.cardBorderWidth, CARD_BORDER_WIDTH_RANGE],
    ["cardBorderOpacity", DEFAULT_LIBRARY_STYLE.cardBorderOpacity, CARD_BORDER_OPACITY_RANGE],
    ["cardOpacity", DEFAULT_LIBRARY_STYLE.cardOpacity, CARD_OPACITY_RANGE],
    ["overlayIntensity", DEFAULT_LIBRARY_STYLE.overlayIntensity, OVERLAY_INTENSITY_RANGE],
    ["contentMaxWidth", DEFAULT_LIBRARY_STYLE.contentMaxWidth, CONTENT_MAX_WIDTH_RANGE],
    ["contentPaddingX", DEFAULT_LIBRARY_STYLE.contentPaddingX, CONTENT_PADDING_RANGE],
    ["contentPaddingY", DEFAULT_LIBRARY_STYLE.contentPaddingY, CONTENT_PADDING_RANGE],
    ["cardFontSize", DEFAULT_LIBRARY_STYLE.cardFontSize, CARD_FONT_SIZE_RANGE],
    ["DEFAULT_BLOCK_STYLE.fontSize", DEFAULT_BLOCK_STYLE.fontSize, BLOCK_FONT_SIZE_RANGE]
  ];
  for (const [name, value, range] of pairs) {
    const stepsFromMin = (value - range.min) / range.step;
    check(
      `${name} (${value}) is min(${range.min}) + a whole number of steps(${range.step})`,
      Number.isInteger(stepsFromMin) && value >= range.min && value <= range.max,
      `(${value} - ${range.min}) / ${range.step} = ${stepsFromMin}`
    );
  }
}

console.log("\n2. resolveLibraryStyle fills in defaults for anything unset");
{
  const resolved = resolveLibraryStyle({ cardMinWidth: 250 });
  check("explicitly-set field kept", resolved.cardMinWidth === 250);
  check("unset field falls back to default", resolved.cardRadius === DEFAULT_LIBRARY_STYLE.cardRadius);
  check("unset field falls back to default (border color)", resolved.cardBorderColor === null);
}

console.log("\n3. resolveBorderColor");
{
  check("opacity 100 with an explicit color returns it unchanged", resolveBorderColor("#38342f", 100) === "#38342f");
  check("opacity 100 with no color (theme default) returns the CSS var", resolveBorderColor(null, 100) === "var(--color-border)");
  check("explicit color below 100 converts to rgba()", resolveBorderColor("#38342f", 50) === "rgba(56, 52, 47, 0.5)");
  check("3-digit hex shorthand expands correctly", resolveBorderColor("#fff", 50) === "rgba(255, 255, 255, 0.5)");
  check(
    "theme-default color below 100 uses color-mix() on the CSS var",
    resolveBorderColor(null, 50) === "color-mix(in srgb, var(--color-border) 50%, transparent)"
  );
  check("opacity 0 with an explicit color is fully transparent", resolveBorderColor("#38342f", 0) === "rgba(56, 52, 47, 0)");
}

console.log("\n4. Border sides default to all-on (matches the pre-existing all-sides look)");
{
  const sides = DEFAULT_LIBRARY_STYLE.cardBorderSides;
  check("top/right/bottom/left all default true", sides.top && sides.right && sides.bottom && sides.left);
}

console.log("\n5. extractPerCardStyle / effectiveCardStyle — per-series style override priority");
{
  const libraryStyle = { ...DEFAULT_LIBRARY_STYLE, cardRadius: 16, cardShadow: true, cardMinWidth: 200 };
  const perCard = extractPerCardStyle(libraryStyle);
  check("extracted subset omits layout fields", !("cardMinWidth" in perCard));
  check("extracted subset omits page fields", !("backgroundColor" in perCard));
  check("extracted subset keeps appearance fields", perCard.cardRadius === 16 && perCard.cardShadow === true);

  const noOverride = effectiveCardStyle(libraryStyle, undefined);
  check("no override → identical to the library style", noOverride === libraryStyle);

  const override = { ...perCard, cardRadius: 4, cardShadow: false };
  const effective = effectiveCardStyle(libraryStyle, override);
  check("override wins for fields it sets", effective.cardRadius === 4 && effective.cardShadow === false);
  check("layout stays library-wide even with an override present (PerCardStyle can't contain it)", effective.cardMinWidth === 200);
}

console.log("\n6. resolvePerCardStyle / effectiveCardStyle survive an INCOMPLETE saved override");
{
  // Regression test: a real bug found while building this — SeriesStylePanel
  // briefly saved a partial object (just the one field the user touched,
  // e.g. `{cardOpacity: 30}`) instead of the full PerCardStyle it was
  // supposed to. Reading that back crashed CardBorderSection on
  // `draft.cardBorderSides.top` — undefined.cardBorderSides has no `.top`.
  // Both the save-time bug and this read-time crash are fixed; this guards
  // the read-time half so a stray incomplete object (whatever produced it)
  // can never crash rendering again.
  const incomplete = { cardOpacity: 30 } as any;

  const resolved = resolvePerCardStyle(incomplete);
  check("missing field filled in from the default", resolved.cardBorderSides !== undefined);
  check("missing field's default value is correct", resolved.cardBorderSides.top === true);
  check("the one present field is kept, not overwritten by the default", resolved.cardOpacity === 30);

  const libraryStyle = { ...DEFAULT_LIBRARY_STYLE, cardBorderSides: { top: false, right: false, bottom: false, left: false } };
  const effective = effectiveCardStyle(libraryStyle, incomplete);
  check(
    "effectiveCardStyle resolves an incomplete override before merging — no undefined leaks through",
    effective.cardBorderSides !== undefined && effective.cardBorderSides.top === true
  );
  check("the incomplete override's one real field still wins over the library style", effective.cardOpacity === 30);
}

console.log("\n7. effectiveCardStyle — full three-level priority chain: book > series > library");
{
  // Each override level, when present, is always a COMPLETE PerCardStyle
  // snapshot (all-or-nothing customization — see PerCardStylePanel.tsx),
  // never a partial patch. So a book override doesn't blend field-by-field
  // with the series' — it fully supersedes it for every per-card field at
  // once, and the series override only matters at all when there's no
  // book override. "Book takes priority over all others" in the simplest
  // possible sense: if it's set, it's what renders, full stop.
  const libraryStyle = { ...DEFAULT_LIBRARY_STYLE, cardRadius: 16, cardShadow: true, cardOpacity: 100 };
  const seriesOverride = extractPerCardStyle({ ...libraryStyle, cardRadius: 8, cardShadow: false });
  const bookOverride = extractPerCardStyle({ ...libraryStyle, cardRadius: 0, cardShadow: true });

  const libraryOnly = effectiveCardStyle(libraryStyle, undefined, undefined);
  check("no overrides → identical to the library style", libraryOnly === libraryStyle);

  const seriesOnly = effectiveCardStyle(libraryStyle, seriesOverride, undefined);
  check("series override alone wins over library", seriesOnly.cardRadius === 8 && seriesOnly.cardShadow === false);

  const bookOverSeries = effectiveCardStyle(libraryStyle, seriesOverride, bookOverride);
  check(
    "a book override fully supersedes the series override (every per-card field is the book's own, not a per-field blend)",
    bookOverSeries.cardRadius === 0 && bookOverSeries.cardShadow === true
  );
  check("layout stays library-wide through the whole chain", bookOverSeries.cardMinWidth === libraryStyle.cardMinWidth);

  const bookOnlyNoSeries = effectiveCardStyle(libraryStyle, undefined, bookOverride);
  check("book override alone (no series) still wins over library", bookOnlyNoSeries.cardRadius === 0);
}

console.log("\n8. BlockStyle — resolveBlockStyle fills in defaults, doesn't carry PerCardStyle's cover-only fields");
{
  const resolved = resolveBlockStyle(undefined);
  check("no override → identical to DEFAULT_BLOCK_STYLE", JSON.stringify(resolved) === JSON.stringify(DEFAULT_BLOCK_STYLE));

  const partial = resolveBlockStyle({ cardRadius: 4 });
  check("a partial override fills in everything else from the default", partial.cardRadius === 4 && partial.cardShadow === DEFAULT_BLOCK_STYLE.cardShadow);
  check("backgroundColor defaults to null (theme surface)", resolveBlockStyle(undefined).backgroundColor === null);
  check(
    "PerCardStyle's cover-only fields (cardAspectRatio/overlayIntensity/showTitleAuthor) aren't part of BlockStyle at all",
    !("cardAspectRatio" in resolved) && !("overlayIntensity" in resolved) && !("showTitleAuthor" in resolved)
  );
  check(
    "BlockStyle shares its border fields' names with PerCardStyle (so CardBorderSection works unmodified for both)",
    "cardBorderWidth" in resolved && "cardBorderStyle" in resolved && "cardBorderColor" in resolved && "cardBorderOpacity" in resolved && "cardBorderSides" in resolved
  );

  check("fontFamily defaults to sans", DEFAULT_BLOCK_STYLE.fontFamily === "sans");
  check("textColor defaults to null (theme default)", DEFAULT_BLOCK_STYLE.textColor === null);
  check(
    "a partial fontSize override still fills in fontFamily/textColor from the default",
    resolveBlockStyle({ fontSize: 20 }).fontFamily === DEFAULT_BLOCK_STYLE.fontFamily && resolveBlockStyle({ fontSize: 20 }).textColor === null
  );
}

console.log("\n9. blockFontFamilyCss — every option resolves to a real CSS stack, unknown values fall back rather than rendering with no font-family");
{
  for (const opt of BLOCK_FONT_FAMILY_OPTIONS) {
    check(`"${opt.value}" resolves to its own css stack`, blockFontFamilyCss(opt.value) === opt.css);
  }
  check(
    "an unrecognized value falls back to the first option rather than returning undefined/empty",
    blockFontFamilyCss("not-a-real-option" as never) === BLOCK_FONT_FAMILY_OPTIONS[0].css
  );
}

console.log("\n10. Card text (cardFontFamily/cardFontSize/cardTextColor) — is a real PerCardStyle field, flows through the whole book/library/series chain");
{
  check("cardFontFamily/cardFontSize/cardTextColor are part of PER_CARD_STYLE_KEYS (so a series/book can override them)", (PER_CARD_STYLE_KEYS as readonly string[]).includes("cardFontFamily") && (PER_CARD_STYLE_KEYS as readonly string[]).includes("cardFontSize") && (PER_CARD_STYLE_KEYS as readonly string[]).includes("cardTextColor"));
  check("cardFontFamily defaults to sans", DEFAULT_LIBRARY_STYLE.cardFontFamily === "sans");
  check("cardTextColor defaults to null (white — see its own comment for why that's NOT the usual 'theme default' meaning)", DEFAULT_LIBRARY_STYLE.cardTextColor === null);

  const extracted = extractPerCardStyle(DEFAULT_LIBRARY_STYLE);
  check("extractPerCardStyle pulls the card text fields out too", extracted.cardFontFamily === "sans" && extracted.cardFontSize === DEFAULT_LIBRARY_STYLE.cardFontSize);

  const libraryStyle = { ...DEFAULT_LIBRARY_STYLE, cardFontFamily: "sans" as const, cardFontSize: 13 };
  const seriesOverride = extractPerCardStyle({ ...libraryStyle, cardFontFamily: "serif" as const, cardFontSize: 16 });
  const bookOverride = extractPerCardStyle({ ...libraryStyle, cardFontFamily: "mono" as const, cardFontSize: 18 });
  check("series override alone changes the effective card font", effectiveCardStyle(libraryStyle, seriesOverride, undefined).cardFontFamily === "serif");
  check("a book override fully supersedes the series override for card text too", effectiveCardStyle(libraryStyle, seriesOverride, bookOverride).cardFontFamily === "mono");
}

console.log("\n11. Isolation — BlockStyle (murals) and PerCardStyle/LibraryStyleSettings (books/library/series) share NO type relationship");
{
  // The actual bug this guards against: BlockStyle used to be
  // `Omit<PerCardStyle, ...> & {...}` — when PerCardStyle grew
  // cardFontFamily/cardFontSize/cardTextColor, BlockStyle silently
  // inherited those too (the Omit never excluded them), so a mural
  // block's style object ended up carrying BOTH `fontFamily` AND
  // `cardFontFamily`. Fixed by making BlockStyle a fully independent
  // declaration — this test would have caught it.
  check(
    "DEFAULT_BLOCK_STYLE has its own fontFamily/fontSize/textColor, NOT PerCardStyle's cardFontFamily/cardFontSize/cardTextColor",
    "fontFamily" in DEFAULT_BLOCK_STYLE &&
      "fontSize" in DEFAULT_BLOCK_STYLE &&
      "textColor" in DEFAULT_BLOCK_STYLE &&
      !("cardFontFamily" in DEFAULT_BLOCK_STYLE) &&
      !("cardFontSize" in DEFAULT_BLOCK_STYLE) &&
      !("cardTextColor" in DEFAULT_BLOCK_STYLE)
  );
  check(
    "DEFAULT_LIBRARY_STYLE has its own cardFontFamily/cardFontSize/cardTextColor, NOT BlockStyle's fontFamily/fontSize/textColor",
    "cardFontFamily" in DEFAULT_LIBRARY_STYLE &&
      "cardFontSize" in DEFAULT_LIBRARY_STYLE &&
      "cardTextColor" in DEFAULT_LIBRARY_STYLE &&
      !("fontFamily" in DEFAULT_LIBRARY_STYLE) &&
      !("fontSize" in DEFAULT_LIBRARY_STYLE) &&
      !("textColor" in DEFAULT_LIBRARY_STYLE)
  );
  check(
    "the two font-family option sets are separately declared, not the same array/reference",
    (BLOCK_FONT_FAMILY_OPTIONS as unknown) !== (CARD_FONT_FAMILY_OPTIONS as unknown)
  );
  check("blockFontFamilyCss and cardFontFamilyCss are two distinct functions", (blockFontFamilyCss as unknown) !== (cardFontFamilyCss as unknown));
}

console.log("\n12. cardFontFamilyCss — every option resolves to a real CSS stack, unknown values fall back rather than rendering with no font-family");
{
  for (const opt of CARD_FONT_FAMILY_OPTIONS) {
    check(`"${opt.value}" resolves to its own css stack`, cardFontFamilyCss(opt.value) === opt.css);
  }
  check(
    "an unrecognized value falls back to the first option rather than returning undefined/empty",
    cardFontFamilyCss("not-a-real-option" as never) === CARD_FONT_FAMILY_OPTIONS[0].css
  );
}

console.log("\n13. Text formatting — cardBold/cardItalic (cards) and bold/italic/codeStyle (blocks)");
{
  check("cardBold/cardItalic default to false", DEFAULT_LIBRARY_STYLE.cardBold === false && DEFAULT_LIBRARY_STYLE.cardItalic === false);
  check(
    "cardBold/cardItalic are part of PER_CARD_STYLE_KEYS (so a series/book can override them)",
    (PER_CARD_STYLE_KEYS as readonly string[]).includes("cardBold") && (PER_CARD_STYLE_KEYS as readonly string[]).includes("cardItalic")
  );

  const libraryStyle = { ...DEFAULT_LIBRARY_STYLE, cardBold: false, cardItalic: false };
  const seriesOverride = extractPerCardStyle({ ...libraryStyle, cardBold: true, cardItalic: true });
  const bookOverride = extractPerCardStyle({ ...libraryStyle, cardBold: false, cardItalic: true });
  check("series override alone changes cardBold/cardItalic", effectiveCardStyle(libraryStyle, seriesOverride, undefined).cardBold === true);
  check(
    "a book override fully supersedes the series override for cardBold/cardItalic too",
    effectiveCardStyle(libraryStyle, seriesOverride, bookOverride).cardBold === false &&
      effectiveCardStyle(libraryStyle, seriesOverride, bookOverride).cardItalic === true
  );

  check(
    "bold/italic/codeStyle default to false on BlockStyle",
    DEFAULT_BLOCK_STYLE.bold === false && DEFAULT_BLOCK_STYLE.italic === false && DEFAULT_BLOCK_STYLE.codeStyle === false
  );
  const resolvedBlock = resolveBlockStyle({ bold: true });
  check("a partial override (bold only) fills in italic/codeStyle from the default", resolvedBlock.italic === false && resolvedBlock.codeStyle === false);
  check(
    // codeStyle is deliberately BlockStyle-only — see its declaration
    // comment in lib/libraryStyle.ts. A book/series card has no equivalent;
    // this guards that isolation the same way test 11 guards fontFamily/
    // fontSize/textColor.
    "codeStyle has no PerCardStyle equivalent — cards only ever get cardBold/cardItalic, never a card 'code style'",
    !("codeStyle" in DEFAULT_LIBRARY_STYLE) && !(PER_CARD_STYLE_KEYS as readonly string[]).includes("codeStyle" as never)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
