# Mural block actions (mobile)

Date: 2026-09-29
Status: design approved in conversation; awaiting spec review
Mockups: `.superpowers/brainstorm/10288-1790702628/content/` (`hybrid-preview-v2.html`, `block-sheet.html`, `style-tab.html`)

## Problem

In the native mural editor (`mobile/src/features/murals/MuralEditorScreen.tsx`),
tapping a block opens one modal "Block settings" sheet that holds everything:
content fields, a raw `Position x…, y…; size w×h` readout, four arrow buttons,
Narrower/Wider/Shorter/Taller buttons, and Duplicate/Delete. It covers the block
being edited. Layout taps that would overlap another block or run off the canvas
are silently ignored. Stats metrics look almost identical ticked and unticked.
Native has no way to edit a block's style.

## Goals

- Selecting a block and acting on it are separate steps. Selection alone opens
  nothing.
- Each kind of change (content, style, size) has its own focused place, with a
  live preview of the block.
- Style editing on native, with friendly controls: no pixels or percentages on
  screen.
- Two new style capabilities, rendered the same on web and native: text
  alignment and inner spacing. Plus an invisible background.
- Theme colours: block colours can follow the viewer's theme (as a `null`
  background already does), alongside fixed colours that never change.

## Non-goals

- Changing the web editor's flow. The web gets only the renderer and data
  changes that the new style fields need, plus minimal controls for them (see
  "Web").
- Redesigning the pickers (book, passage, image, tier list). They keep working
  as today.
- Removing passages from a Quote collection. You can't do that on native today,
  and it's a separate fix.
- Undo. The editor already keeps everything local until Save.

## 1. Selection and the action bar

- **Nothing selected:** the dock shows Add block / Share, as today.
- **Tap a block:** it gets the accent border, and the dock becomes an action
  bar with **Done · Edit · Style · Size · Copy · Delete** (icon + label each).
  No sheet opens. This is the coupling that broke the old dock in #43
  (`3eb94ee2`).
- **Edit is hidden** for block types with no content fields: `currentlyReading`,
  `empty`, `readerCard`.
- **Deselect:** Done, or tap empty canvas.
- **Edit / Style / Size** open the block sheet on the Content / Style / Layout
  tab. Closing the sheet keeps the block selected with the bar showing.
- **Copy:** `createDuplicateCandidate`, then select the copy.
- **Delete:** remove the block and deselect. No confirm, the same reasoning as
  the web (`MuralEditorPage.tsx:263`). Nothing is saved until Save.
- **Move:** long-press and drag, unchanged. For screen readers, each block gets
  `accessibilityActions` for Move left / right / up / down, applied through
  `changeBlockLayout`. These replace the arrow buttons, which were the only
  accessible way to move a block.
- **Removed:** the arrow buttons, the size buttons and the position readout.
- New glyphs go in `mobile/src/ui/icon.tsx`: edit, style, resize, duplicate.

## 2. Block sheet

One sheet component in the editor, opened on a tab, using the existing `Sheet`.

- **Height:** close to full height (the `Sheet` allows up to 90%), and the same
  on every tab, so switching tabs doesn't jump.
- **Title:** the block type label (`BLOCK_TYPE_LABELS`).
- **No Copy/Delete inside:** they're on the action bar.
- **Preview card:** pinned at the top, and it doesn't scroll with the tab body.
  - The block is rendered exactly as the canvas renders it, at its real canvas
    size (`w × columnWidth − GAP` by `h × ROW_HEIGHT − GAP`). It's then scaled
    with a transform to fit a fixed preview area, capped at about 200pt tall.
  - It updates as you edit.
  - To make it match the canvas exactly, the frame styling in `CanvasBlock`
    (background, border, radius, shadow, opacity, padding) moves into one
    component that both the canvas and the preview use.
- **Tabs:** `Segmented`, with Content / Style / Layout. Blocks with no content
  fields show only Style / Layout.
- **Keyboard:** the tab body scrolls under the pinned preview. A focused text
  field must stay above the keyboard; reuse `ui/keyboardScroll.ts`.

### Content tab

The same fields as today, rearranged. A row that shows the current choice and a
`›` opens today's picker sheet. Closing the picker returns to the block sheet.

| Block | Fields |
|---|---|
| Shelf | Title (hint: blank uses the collection's name). Source: `Segmented` Pick books / Follow a collection. Pick → "Books: N chosen ›". Follow → `SelectRow` of collections; the Follow option is hidden when there are no collections |
| Spotlight | "Book: <title> ›", Caption |
| Quote | Source: `Segmented` Pinned passage / Rediscover. Pinned → "Passage ›" (book, then passage, as today) |
| Quote collection | Title, "Passages: N ›" |
| Image | "Image: <filename> ›", Caption |
| Text | Heading, Body |
| Profile | Bio, genre chips (unchanged) |
| Stats | One `ToggleRow` per metric |
| Tier list | "Tier list: <name> ›" |

### Style tab

Every control is a choice you can see. Values set on web that don't match any
preset are kept, and no chip is highlighted for them until the user picks one.
Order, top to bottom:

1. **Quick looks:** two rows of small swatch cards, each drawn as it will look.
   A look sets background, text colour, font, bold/italic/code, corners,
   border (width, colour, style, strength, sides) and shadow. It leaves text
   size, alignment, inner spacing and fade alone. A look is an action, not a
   state: no look is shown as selected afterwards. The tab's other controls
   show what the look set.

   **Theme looks** re-colour for every theme and every viewer (section 3):

   | Look | Background | Text | Font | Corners | Border | Shadow |
   |---|---|---|---|---|---|---|
   | Plain | `null` (surface) | auto | sans | Rounded | Thin, auto | Soft |
   | Bare | `transparent` | auto | sans | Rounded | None | None |
   | Tinted | `theme:accentSoft` | auto | sans | Rounded | None | Soft |
   | Accent | `theme:accent` | `theme:onAccent` | sans, bold | Rounded | None | Soft |
   | Outline | `transparent` | auto | sans | Rounded | Thick, `theme:accent` | None |

   **Fixed looks** use the same colours in every theme:

   | Look | Background | Text | Font | Corners | Border | Shadow |
   |---|---|---|---|---|---|---|
   | Paper | `#f6efe3` | `#201e1c` | serif | Slight | Thin, auto | Soft |
   | Note | `#fff3b0` | `#201e1c` | mono | Square | None | Soft |
   | Ink | `#201e1c` | `#f2f0ec` | serif | Rounded | None | Soft |
   | Clay | `#97532d` | `#ffffff` | sans, bold | Rounded | None | Soft |

   Every look resets the border style to Solid, the strength to Solid and the
   sides to All. A fixed look that sets a background also sets the text colour,
   so it stays readable on every theme.
2. **Colour rows** (Background, Text colour, Border colour) share one layout:
   the row's default first, then a **Theme** group of swatches drawn in the
   current theme's colours and labelled "Changes with the theme", then a
   **Fixed** group.

   | Row | Default | Theme swatches | Fixed swatches |
   |---|---|---|---|
   | Background | None (checkerboard, `"transparent"`); Theme (`null`) | Page `background`, Tint `accentSoft`, Fill `accentFill`, Accent `accent` | `#ffffff #f1e2d8 #e4efdf #dcebf2 #ebe4f3 #fff3b0 #201e1c` |
   | Text colour | Auto (`null`) | Accent `accent`, On accent `onAccent` | `SWATCHES` from `StyleControls.tsx` |
   | Border colour | Auto (`null`) | Accent `accent`, Text `text` | `SWATCHES` |

   Picking None for the background also sets `cardShadow: false`, because a
   shadow under an invisible card looks like a ghost box.
3. **Corners:** four picture tiles. Square 0, Slight 4, Rounded 12 (default),
   Round 24 (all on `CARD_RADIUS_RANGE`'s grid).
4. **Text:**
   - Font chips, each label drawn in its own face, for all six
     `BLOCK_FONT_FAMILY_OPTIONS`.
   - Size chips S 12 / M 14 / L 17 / XL 20.
   - Emphasis toggles for bold / italic / code.
   - Alignment toggles for left / centre / right.
   - The Text colour row.
5. **Hard-to-read warning:** shown under the text colour when
   `contrastRatio(effective text, effective background) < 4.5`. Both colours are
   first resolved against the current theme (section 3). The effective text is
   `textColor ?? theme.text`. The effective background is `theme.background`
   when transparent and `theme.surface` when `null`. There's no warning when
   `contrastRatio` returns `null`.
6. **Border:**
   - Width: None 0 / Thin 1 / Thick 3. The rest of this group shows only when
     the width isn't None.
   - Style: Solid / Dashed / Dotted. The native app can't draw
     double/groove/ridge.
   - Strength (`cardBorderOpacity`): Faint 40 / Medium 72 / Solid 100.
   - Sides (`cardBorderSides`): All / Top & bottom / Left & right / Bottom
     only, each drawn as a small square with those edges.
   - The Border colour row.
7. **Shadow:** None / Soft.
8. **Fade** (`cardOpacity`): None 100 / Light 72 / Strong 40.
9. **Inner spacing:** Tight / Normal / Roomy.
10. **Footer:** Reset (removes `block.style`, so it resolves to the defaults),
    Copy style, and Paste style. Copied style is held in editor state for the
    session, and Paste is disabled until something has been copied. Paste
    replaces the whole style.

The hover effect (`cardHoverEffect`) isn't shown on native, and its value is
kept. On web it lifts the block when you hover while viewing. On native a mural
being viewed can't be tapped, so there's nothing for it to react to. Editing on
the phone must not switch it off for web viewers.

### Layout tab

- `StepperRow`-style Width ("N of 12 columns") and Height ("N rows").
- A step that `changeBlockLayout` would reject is disabled, with one line saying
  why:
  - "Reached the edge of the mural" when `x + w + 1 > GRID_COLUMNS`.
  - "Another block is in the way" for an overlap.
  - At the minimum of 1, the step is disabled with no message.
- The reason comes from a new helper in `mobile/src/features/murals/layout.ts`.
- A line pointing to dragging on the canvas to move the block.

## 3. Style data changes (shared)

In `packages/shared/src/library/libraryStyle.ts`:

- `BlockStyle` gains `textAlign: "left" | "center" | "right"` and
  `innerSpacing: "tight" | "normal" | "roomy"`.
- `DEFAULT_BLOCK_STYLE` gets `textAlign: "left"` and `innerSpacing: "normal"`,
  so `resolveBlockStyle` fills them in for existing murals.
- `backgroundColor` may be `"transparent"`.
- **Theme colour references.**
  - `backgroundColor`, `textColor` and `cardBorderColor` may hold
    `theme:<key>`, where `<key>` is one of `background`, `surface`, `text`,
    `accent`, `accentSoft`, `accentFill` or `onAccent` (the palette keys in
    `themes/palettes.ts`).
  - A new shared `resolveBlockColor(value, palette)` returns the palette's hex
    for a reference and passes any other value through unchanged. An unknown
    key resolves to `null`, which means the theme default.
  - Every renderer and helper that reads these fields resolves them first,
    against the viewer's theme.
- `blockTextColors` (`murals/blockTextColors.ts`) resolves references, takes
  `background` in its theme argument, and measures against it when the
  background is `"transparent"`. Every caller passes it.

The backend passes `block.style` through without validation, so it needs no
change.

## 4. Rendering (both clients)

- **Alignment.**
  - Native: `blockTextStyles` sets `textAlign`.
  - Web: the block wrapper sets `text-align` in `MuralCanvas.tsx` and
    `MobileMuralCanvas.tsx`. Elements that set their own alignment (the two
    `text-center` spots, the empty-block message) keep it.
- **Inner spacing.**
  - Native: the block frame padding becomes Tight `spacing.sm` / Normal
    `spacing.lg` (today) / Roomy `spacing.xxl`.
  - Web: each block view's outer padding has its own class (`p-2.5`, `p-3`,
    `p-3.5`, `p-4` across `blocks/*.tsx` and `MobileBlockPreview.tsx`). Those
    classes are scaled by a `--block-pad` CSS variable set on the wrapper
    (0.5 / 1 / 1.6). Normal renders exactly as today.
- **Transparent background:** already renders on both clients. Only the dim
  text colour changes (section 3).
- **Theme colour references:** the native block frame and the web wrappers
  (`MuralCanvas.tsx`, `MobileMuralCanvas.tsx`) pass `backgroundColor`,
  `textColor` and `cardBorderColor` through `resolveBlockColor` with the
  viewer's palette. On web that palette is the `themeColors` both canvases
  already compute. The resolved border colour then goes through each client's
  existing `resolveBorderColor`.
- **Border sides on native:** the mural block frame draws per-side widths from
  `cardBorderSides`, the same way `BookCard.tsx:55` does. Web already draws
  them.

## 5. Web

These are the only web changes beyond rendering, so the new fields can be
edited everywhere. They go in `BlockStylePanel` via `frontend/src/components/StyleControls.tsx`:

- An alignment select.
- An inner-spacing select.
- A "No background" option next to the custom-background toggle. Today,
  `<input type="color">` would show `"transparent"` as black.
- When the background, text or border colour holds a theme reference, its row
  shows "Theme colour: <name>" with a "Use a custom colour" button in place of
  the colour input. Otherwise the input would show black and overwrite the
  reference on first touch. Web doesn't offer picking theme colours itself;
  those come from native.

## Testing

- **Shared:**
  - `blockTextColors` with a `"transparent"` background measures against
    `background`, and resolves theme references.
  - `resolveBlockColor`: reference → palette hex, hex passes through,
    `transparent` passes through, unknown key → `null`.
  - `resolveBlockStyle` fills `textAlign`/`innerSpacing` for old styles.
- **Mobile unit** (`npm test --workspace mobile`):
  - The layout-reason helper (edge, overlap, minimum, allowed).
  - Quick looks leave size/alignment/spacing/fade untouched and produce a
    complete `BlockStyle`. Every theme look passes the hard-to-read check in
    all 11 themes. A theme look that fails there is a bad look definition, not
    a test to loosen.
  - Preset matching (a value off-preset highlights nothing).
  - The hard-to-read predicate.
- **Web:** `typecheck`, `lint` and `test` for the frontend workspace. A
  `scripts/test-*.mts` style test that asserts Normal spacing resolves to
  today's padding.
- **Device pass:** check `node scripts/dev-status.mjs --json` first, and skip
  if another worktree holds the emulator. Select → bar → each tab → pickers
  and back → Copy/Delete. Theme and fixed looks in light, dark and one
  high-contrast theme (Matrix), then switch the app theme and confirm the theme
  looks re-colour. Border sides. Keyboard with the Text block's Body field.
