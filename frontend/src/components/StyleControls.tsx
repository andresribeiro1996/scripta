import type { ReactNode } from "react";
import {
  BLOCK_FONT_FAMILY_OPTIONS,
  BLOCK_FONT_SIZE_RANGE,
  CARD_ASPECT_RATIO_OPTIONS,
  CARD_BORDER_OPACITY_RANGE,
  CARD_BORDER_STYLE_OPTIONS,
  CARD_BORDER_WIDTH_RANGE,
  CARD_FONT_FAMILY_OPTIONS,
  CARD_FONT_SIZE_RANGE,
  CARD_OPACITY_RANGE,
  CARD_RADIUS_RANGE,
  OVERLAY_INTENSITY_RANGE,
  type BlockFontFamily,
  type BlockStyle,
  type CardAspectRatio,
  type CardBorderStyle,
  type CardFontFamily,
  type PerCardStyle
} from "../lib/libraryStyle";

// Shared building blocks for /dashboard/style (the full library-wide
// panel, LibraryStylePage.tsx), the per-series/per-book style panel
// (PerCardStylePanel.tsx), and mural blocks' own style panel
// (components/murals/BlockStylePanel.tsx) — same controls, same look,
// different scope. CardAppearanceSection/CardContentSection are specific
// to PerCardStyle (cover-rendering concepts a mural block doesn't have —
// see lib/libraryStyle.ts's BlockStyle comment for why); CardBorderSection
// only ever touches the 5 border fields both PerCardStyle and BlockStyle
// share by name, so it's typed against just that Pick and works for
// either without modification.

export function Section({ title, children, wide }: { title?: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-xl border border-(--color-border) bg-(--color-surface) p-4 ${wide ? "sm:col-span-2" : ""}`}>
      {title && <h4 className="mb-3 text-xs font-semibold tracking-wide text-(--color-text-dim) uppercase">{title}</h4>}
      {children}
    </section>
  );
}

export function SliderRow({
  id,
  label,
  value,
  unit = "px",
  range,
  onChange
}: {
  id: string;
  label: string;
  value: number;
  unit?: string;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="mb-1 flex items-center justify-between text-sm font-semibold" htmlFor={id}>
        <span>{label}</span>
        <span className="font-normal text-(--color-text-dim)">
          {value}
          {unit}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

export function ToggleRow({
  id,
  label,
  checked,
  hint,
  onChange
}: {
  id: string;
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className="mt-1 text-xs text-(--color-text-dim)">{hint}</p>}
    </div>
  );
}

/** Props shared by every per-card-style section below: `idPrefix` keeps
 *  element ids unique when both the library-wide panel and a series
 *  panel could in principle render at once (they don't today, but costs
 *  nothing); `onApply` debounces (slider drags), `onSaveNow` commits
 *  immediately (checkboxes/selects) — same split LibraryStylePage always
 *  used, now just parameterized. */
interface CardStyleSectionProps {
  idPrefix: string;
  draft: PerCardStyle;
  onApply: (patch: Partial<PerCardStyle>) => void;
  onSaveNow: (patch: Partial<PerCardStyle>) => void;
}

export function CardAppearanceSection({ idPrefix, draft, onApply, onSaveNow }: CardStyleSectionProps) {
  return (
    <Section title="Card appearance">
      <SliderRow
        id={`${idPrefix}-card-radius`}
        label="Corner radius"
        value={draft.cardRadius}
        range={CARD_RADIUS_RANGE}
        onChange={(v) => onApply({ cardRadius: v })}
      />

      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-card-aspect`}>
          Cover shape
        </label>
        <select
          id={`${idPrefix}-card-aspect`}
          value={draft.cardAspectRatio}
          onChange={(e) => onSaveNow({ cardAspectRatio: e.target.value as CardAspectRatio })}
          className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
        >
          {CARD_ASPECT_RATIO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-overlay-intensity`}
        label="Text overlay darkness"
        value={draft.overlayIntensity}
        unit="%"
        range={OVERLAY_INTENSITY_RANGE}
        onChange={(v) => onApply({ overlayIntensity: v })}
      />

      <SliderRow
        id={`${idPrefix}-card-opacity`}
        label="Card opacity"
        value={draft.cardOpacity}
        unit="%"
        range={CARD_OPACITY_RANGE}
        onChange={(v) => onApply({ cardOpacity: v })}
      />

      <ToggleRow id={`${idPrefix}-card-shadow`} label="Drop shadow" checked={draft.cardShadow} onChange={(v) => onSaveNow({ cardShadow: v })} />
      <ToggleRow
        id={`${idPrefix}-card-hover`}
        label="Hover animation"
        checked={draft.cardHoverEffect}
        hint="Lift, scale up slightly, and deepen the shadow when you hover a card."
        onChange={(v) => onSaveNow({ cardHoverEffect: v })}
      />
    </Section>
  );
}

const BORDER_SIDE_KEYS = ["top", "right", "bottom", "left"] as const;

type CardBorderFields = "cardBorderWidth" | "cardBorderStyle" | "cardBorderColor" | "cardBorderOpacity" | "cardBorderSides";

interface CardBorderSectionProps {
  idPrefix: string;
  draft: Pick<PerCardStyle, CardBorderFields>;
  onApply: (patch: Partial<Pick<PerCardStyle, CardBorderFields>>) => void;
  onSaveNow: (patch: Partial<Pick<PerCardStyle, CardBorderFields>>) => void;
}

export function CardBorderSection({ idPrefix, draft, onApply, onSaveNow }: CardBorderSectionProps) {
  const usingCustomBorderColor = draft.cardBorderColor !== null;

  return (
    <Section title="Card border">
      <SliderRow
        id={`${idPrefix}-card-border-width`}
        label="Border width"
        value={draft.cardBorderWidth}
        range={CARD_BORDER_WIDTH_RANGE}
        onChange={(v) => onApply({ cardBorderWidth: v })}
      />

      <div className="mb-4">
        <span className="mb-1 block text-sm font-semibold">Sides</span>
        <div className="flex flex-wrap gap-3">
          {BORDER_SIDE_KEYS.map((side) => (
            <label key={side} className="flex items-center gap-1.5 text-sm capitalize" htmlFor={`${idPrefix}-border-side-${side}`}>
              <input
                id={`${idPrefix}-border-side-${side}`}
                type="checkbox"
                disabled={draft.cardBorderWidth === 0}
                checked={draft.cardBorderSides[side]}
                onChange={(e) => onSaveNow({ cardBorderSides: { ...draft.cardBorderSides, [side]: e.target.checked } })}
              />
              {side}
            </label>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-card-border-style`}>
          Border style
        </label>
        <select
          id={`${idPrefix}-card-border-style`}
          value={draft.cardBorderStyle}
          disabled={draft.cardBorderWidth === 0}
          onChange={(e) => onSaveNow({ cardBorderStyle: e.target.value as CardBorderStyle })}
          className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm disabled:opacity-60"
        >
          {CARD_BORDER_STYLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-card-border-opacity`}
        label="Border opacity"
        value={draft.cardBorderOpacity}
        unit="%"
        range={CARD_BORDER_OPACITY_RANGE}
        onChange={(v) => onApply({ cardBorderOpacity: v })}
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-custom-border-color-toggle`}>
          <input
            id={`${idPrefix}-custom-border-color-toggle`}
            type="checkbox"
            checked={usingCustomBorderColor}
            disabled={draft.cardBorderWidth === 0}
            onChange={(e) => {
              if (e.target.checked) {
                const computed = getComputedStyle(document.documentElement).getPropertyValue("--color-border").trim();
                onSaveNow({ cardBorderColor: computed || "#38342f" });
              } else {
                onSaveNow({ cardBorderColor: null });
              }
            }}
          />
          Custom border color
        </label>
        {usingCustomBorderColor && (
          <input
            type="color"
            value={draft.cardBorderColor ?? "#38342f"}
            onChange={(e) => onApply({ cardBorderColor: e.target.value })}
            className="h-8 w-16 rounded border border-(--color-border) bg-transparent"
          />
        )}
      </div>
      {draft.cardBorderWidth === 0 && <p className="mt-1 text-xs text-(--color-text-dim)">Set a border width above to enable a border.</p>}
    </Section>
  );
}

export function CardContentSection({ idPrefix, draft, onSaveNow }: CardStyleSectionProps) {
  return (
    <Section title="Card content" wide>
      <ToggleRow
        id={`${idPrefix}-show-title-author`}
        label="Show title and author on cards"
        checked={draft.showTitleAuthor}
        hint="Always shown for a book with no cover — otherwise there'd be nothing on the card at all."
        onChange={(v) => onSaveNow({ showTitleAuthor: v })}
      />
    </Section>
  );
}

type CardTextFields = "cardFontFamily" | "cardFontSize" | "cardTextColor" | "cardBold" | "cardItalic";

/** A card's title/author/status typeface, base text size, and text color
 *  — same "card layout/appearance/border/content/text" tier as the other
 *  Card*Section components, applied to a book's overlay text wherever a
 *  BookCard renders (Library, Series, Collections, murals' book blocks).
 *  Deliberately its own type/section, not shared with mural blocks'
 *  BlockTextSection below — see CardFontFamily's own comment for why. */
export function CardTextSection({ idPrefix, draft, onApply, onSaveNow }: { idPrefix: string; draft: Pick<PerCardStyle, CardTextFields>; onApply: (patch: Partial<Pick<PerCardStyle, CardTextFields>>) => void; onSaveNow: (patch: Partial<Pick<PerCardStyle, CardTextFields>>) => void }) {
  const usingCustomTextColor = draft.cardTextColor !== null;

  return (
    <Section title="Card text" wide>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-card-font-family`}>
          Font
        </label>
        <select
          id={`${idPrefix}-card-font-family`}
          value={draft.cardFontFamily}
          onChange={(e) => onSaveNow({ cardFontFamily: e.target.value as CardFontFamily })}
          className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
        >
          {CARD_FONT_FAMILY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-card-font-size`}
        label="Text size"
        value={draft.cardFontSize}
        range={CARD_FONT_SIZE_RANGE}
        onChange={(v) => onApply({ cardFontSize: v })}
      />

      <div className="mb-4 flex gap-4">
        <ToggleRow id={`${idPrefix}-card-bold`} label="Bold" checked={draft.cardBold} onChange={(v) => onSaveNow({ cardBold: v })} />
        <ToggleRow id={`${idPrefix}-card-italic`} label="Italic" checked={draft.cardItalic} onChange={(v) => onSaveNow({ cardItalic: v })} />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-custom-card-text-color-toggle`}>
          <input
            id={`${idPrefix}-custom-card-text-color-toggle`}
            type="checkbox"
            checked={usingCustomTextColor}
            onChange={(e) => onSaveNow({ cardTextColor: e.target.checked ? "#ffffff" : null })}
          />
          Custom text color
        </label>
        {usingCustomTextColor && (
          <input
            type="color"
            value={draft.cardTextColor ?? "#ffffff"}
            onChange={(e) => onApply({ cardTextColor: e.target.value })}
            className="h-8 w-16 rounded border border-(--color-border) bg-transparent"
          />
        )}
      </div>
      <p className="mt-1 text-xs text-(--color-text-dim)">
        Applies to the title, author, and status text shown over the cover art — defaults to white since that text
        always sits on a dark scrim, regardless of your theme.
      </p>
    </Section>
  );
}

type BlockAppearanceFields = "backgroundColor" | "cardRadius" | "cardOpacity" | "cardShadow" | "cardHoverEffect";

/** BlockStyle's counterpart to CardAppearanceSection — same radius/
 *  opacity/shadow/hover controls, minus the two cover-specific ones
 *  (Cover shape, Text overlay darkness) a mural block has no use for,
 *  plus a background color control no BookCard equivalent needs (its
 *  background is always the cover art). Used only by
 *  components/murals/BlockStylePanel.tsx. */
export function BlockAppearanceSection({
  idPrefix,
  draft,
  onApply,
  onSaveNow
}: {
  idPrefix: string;
  draft: Pick<BlockStyle, BlockAppearanceFields>;
  onApply: (patch: Partial<Pick<BlockStyle, BlockAppearanceFields>>) => void;
  onSaveNow: (patch: Partial<Pick<BlockStyle, BlockAppearanceFields>>) => void;
}) {
  const usingCustomBackground = draft.backgroundColor !== null;

  return (
    <Section title="Block appearance">
      <div className="mb-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-custom-bg-toggle`}>
          <input
            id={`${idPrefix}-custom-bg-toggle`}
            type="checkbox"
            checked={usingCustomBackground}
            onChange={(e) => {
              if (e.target.checked) {
                const computed = getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim();
                onSaveNow({ backgroundColor: computed || "#ffffff" });
              } else {
                onSaveNow({ backgroundColor: null });
              }
            }}
          />
          Custom background color
        </label>
        {usingCustomBackground && (
          <input
            type="color"
            value={draft.backgroundColor ?? "#ffffff"}
            onChange={(e) => onApply({ backgroundColor: e.target.value })}
            className="h-8 w-16 rounded border border-(--color-border) bg-transparent"
          />
        )}
      </div>

      <SliderRow
        id={`${idPrefix}-block-radius`}
        label="Corner radius"
        value={draft.cardRadius}
        range={CARD_RADIUS_RANGE}
        onChange={(v) => onApply({ cardRadius: v })}
      />

      <SliderRow
        id={`${idPrefix}-block-opacity`}
        label="Block opacity"
        value={draft.cardOpacity}
        unit="%"
        range={CARD_OPACITY_RANGE}
        onChange={(v) => onApply({ cardOpacity: v })}
      />

      <ToggleRow id={`${idPrefix}-block-shadow`} label="Drop shadow" checked={draft.cardShadow} onChange={(v) => onSaveNow({ cardShadow: v })} />
      <ToggleRow
        id={`${idPrefix}-block-hover`}
        label="Hover animation"
        checked={draft.cardHoverEffect}
        hint="Lift, scale up slightly, and deepen the shadow when you hover the block."
        onChange={(v) => onSaveNow({ cardHoverEffect: v })}
      />
    </Section>
  );
}

type BlockTextFields = "fontFamily" | "fontSize" | "textColor" | "bold" | "italic" | "codeStyle";

/** A block's typeface, base text size, and primary text color. Used only
 *  by components/murals/BlockStylePanel.tsx — no BookCard equivalent,
 *  since a book's title/author is always a fixed size relative to the
 *  card and the theme's own text color, never independently stylable. */
export function BlockTextSection({
  idPrefix,
  draft,
  onApply,
  onSaveNow
}: {
  idPrefix: string;
  draft: Pick<BlockStyle, BlockTextFields>;
  onApply: (patch: Partial<Pick<BlockStyle, BlockTextFields>>) => void;
  onSaveNow: (patch: Partial<Pick<BlockStyle, BlockTextFields>>) => void;
}) {
  const usingCustomTextColor = draft.textColor !== null;

  return (
    <Section title="Block text" wide>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-font-family`}>
          Font
        </label>
        <select
          id={`${idPrefix}-font-family`}
          value={draft.fontFamily}
          onChange={(e) => onSaveNow({ fontFamily: e.target.value as BlockFontFamily })}
          className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
        >
          {BLOCK_FONT_FAMILY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-font-size`}
        label="Text size"
        value={draft.fontSize}
        range={BLOCK_FONT_SIZE_RANGE}
        onChange={(v) => onApply({ fontSize: v })}
      />

      <div className="mb-4 flex gap-4">
        <ToggleRow id={`${idPrefix}-bold`} label="Bold" checked={draft.bold} onChange={(v) => onSaveNow({ bold: v })} />
        <ToggleRow id={`${idPrefix}-italic`} label="Italic" checked={draft.italic} onChange={(v) => onSaveNow({ italic: v })} />
      </div>
      <ToggleRow
        id={`${idPrefix}-code-style`}
        label="Code style"
        checked={draft.codeStyle}
        hint="Renders in monospace, like inline code — overrides the font choice above regardless of what it's set to."
        onChange={(v) => onSaveNow({ codeStyle: v })}
      />

      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-custom-text-color-toggle`}>
          <input
            id={`${idPrefix}-custom-text-color-toggle`}
            type="checkbox"
            checked={usingCustomTextColor}
            onChange={(e) => {
              if (e.target.checked) {
                const computed = getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim();
                onSaveNow({ textColor: computed || "#1a1a1a" });
              } else {
                onSaveNow({ textColor: null });
              }
            }}
          />
          Custom text color
        </label>
        {usingCustomTextColor && (
          <input
            type="color"
            value={draft.textColor ?? "#1a1a1a"}
            onChange={(e) => onApply({ textColor: e.target.value })}
            className="h-8 w-16 rounded border border-(--color-border) bg-transparent"
          />
        )}
      </div>
      <p className="mt-1 text-xs text-(--color-text-dim)">Applies to the block's main text — captions, labels, and quote attributions stay their own muted color.</p>
    </Section>
  );
}
