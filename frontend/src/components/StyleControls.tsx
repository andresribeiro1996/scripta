import { CHECKBOX_CLASS, RANGE_CLASS } from "./Toolbar";
import { FIELD_CLASS } from "./page/buttonClasses";
import { PANEL, PANEL_HEADING } from "./page/surfaceClasses";
import type { ReactNode } from "react";
import { BLOCK_GRADIENT_ANGLE_RANGE, BLOCK_GRADIENT_STRENGTH_RANGE, BLOCK_SHADOW_BLUR_RANGE, BLOCK_SHADOW_OFFSET_RANGE, BLOCK_SHADOW_OPACITY_RANGE, blockThemeColorLabels, parseThemeColorRef } from "@scripta/shared";
import {
  blockBackgroundFinishOptions,
  blockFontFamilyOptions,
  BLOCK_FONT_SIZE_RANGE,
  blockInnerSpacingOptions,
  blockTextAlignOptions,
  cardAspectRatioOptions,
  CARD_BORDER_OPACITY_RANGE,
  cardBorderStyleOptions,
  CARD_BORDER_WIDTH_RANGE,
  cardFontFamilyOptions,
  CARD_FONT_SIZE_RANGE,
  CARD_OPACITY_RANGE,
  CARD_RADIUS_RANGE,
  OVERLAY_INTENSITY_RANGE,
  type BlockBackgroundFinish,
  type BlockFontFamily,
  type BlockInnerSpacing,
  type BlockStyle,
  type BlockTextAlign,
  type CardAspectRatio,
  type CardBorderStyle,
  type CardFontFamily,
  type PerCardStyle
} from "../lib/libraryStyle";
import { useLocale, useT } from "../i18n";

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
    <section className={wide ? "sm:col-span-2" : ""}>
      {title && <h2 className={`${PANEL_HEADING} mb-3`}>{title}</h2>}
      <div className={`${PANEL} p-4`}>{children}</div>
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
        className={RANGE_CLASS}
      />
    </div>
  );
}

function ColorValueInput({ value, fallback, onChange, label }: { value: string; fallback: string; onChange: (color: string) => void; label?: string }) {
  const locale = useLocale();
  const t = useT();
  const themeKey = parseThemeColorRef(value);
  if (themeKey) {
    return (
      <span className="flex items-center gap-2 text-sm text-(--color-text-dim)">
        {t("settings.themeColor", { color: blockThemeColorLabels(locale)[themeKey] })}
        <button type="button" onClick={() => onChange(fallback)} className="min-h-11 font-semibold text-(--color-text) underline decoration-(--color-accent)">
          {t("settings.useCustomColor")}
        </button>
      </span>
    );
  }
  return <input type="color" aria-label={label ?? t("settings.customColor")} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-16 rounded border border-(--color-border) bg-transparent" />;
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
        <input id={id} type="checkbox" className={CHECKBOX_CLASS} checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
  const locale = useLocale();
  const t = useT();
  return (
    <Section title={t("settings.cardAppearance")}>
      <SliderRow
        id={`${idPrefix}-card-radius`}
        label={t("settings.cornerRadius")}
        value={draft.cardRadius}
        range={CARD_RADIUS_RANGE}
        onChange={(v) => onApply({ cardRadius: v })}
      />

      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-card-aspect`}>
          {t("settings.coverShape")}
        </label>
        <select
          id={`${idPrefix}-card-aspect`}
          value={draft.cardAspectRatio}
          onChange={(e) => onSaveNow({ cardAspectRatio: e.target.value as CardAspectRatio })}
          className={`${FIELD_CLASS} w-full`}
        >
          {cardAspectRatioOptions(locale).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-overlay-intensity`}
        label={t("settings.overlayDarkness")}
        value={draft.overlayIntensity}
        unit="%"
        range={OVERLAY_INTENSITY_RANGE}
        onChange={(v) => onApply({ overlayIntensity: v })}
      />

      <SliderRow
        id={`${idPrefix}-card-opacity`}
        label={t("settings.cardOpacity")}
        value={draft.cardOpacity}
        unit="%"
        range={CARD_OPACITY_RANGE}
        onChange={(v) => onApply({ cardOpacity: v })}
      />

      <ToggleRow id={`${idPrefix}-card-shadow`} label={t("settings.dropShadow")} checked={draft.cardShadow} onChange={(v) => onSaveNow({ cardShadow: v })} />
      <ToggleRow
        id={`${idPrefix}-card-hover`}
        label={t("settings.hoverAnimation")}
        checked={draft.cardHoverEffect}
        hint={t("settings.cardHoverHint")}
        onChange={(v) => onSaveNow({ cardHoverEffect: v })}
      />
    </Section>
  );
}

const BORDER_SIDE_KEYS = ["top", "right", "bottom", "left"] as const;

const BORDER_SIDE_LABELS = { top: "settings.sideTop", right: "settings.sideRight", bottom: "settings.sideBottom", left: "settings.sideLeft" } as const;

type CardBorderFields = "cardBorderWidth" | "cardBorderStyle" | "cardBorderColor" | "cardBorderOpacity" | "cardBorderSides";

interface CardBorderSectionProps {
  idPrefix: string;
  draft: Pick<PerCardStyle, CardBorderFields>;
  onApply: (patch: Partial<Pick<PerCardStyle, CardBorderFields>>) => void;
  onSaveNow: (patch: Partial<Pick<PerCardStyle, CardBorderFields>>) => void;
}

export function CardBorderSection({ idPrefix, draft, onApply, onSaveNow }: CardBorderSectionProps) {
  const locale = useLocale();
  const t = useT();
  const usingCustomBorderColor = draft.cardBorderColor !== null;

  return (
    <Section title={t("settings.cardBorder")}>
      <SliderRow
        id={`${idPrefix}-card-border-width`}
        label={t("settings.borderWidth")}
        value={draft.cardBorderWidth}
        range={CARD_BORDER_WIDTH_RANGE}
        onChange={(v) => onApply({ cardBorderWidth: v })}
      />

      <div className="mb-4">
        <span className="mb-1 block text-sm font-semibold">{t("settings.sides")}</span>
        <div className="flex flex-wrap gap-3">
          {BORDER_SIDE_KEYS.map((side) => (
            <label key={side} className="flex items-center gap-1.5 text-sm capitalize" htmlFor={`${idPrefix}-border-side-${side}`}>
              <input
                id={`${idPrefix}-border-side-${side}`}
                type="checkbox"
                className={CHECKBOX_CLASS}
                disabled={draft.cardBorderWidth === 0}
                checked={draft.cardBorderSides[side]}
                onChange={(e) => onSaveNow({ cardBorderSides: { ...draft.cardBorderSides, [side]: e.target.checked } })}
              />
              {t(BORDER_SIDE_LABELS[side])}
            </label>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-card-border-style`}>
          {t("settings.borderStyle")}
        </label>
        <select
          id={`${idPrefix}-card-border-style`}
          value={draft.cardBorderStyle}
          disabled={draft.cardBorderWidth === 0}
          onChange={(e) => onSaveNow({ cardBorderStyle: e.target.value as CardBorderStyle })}
          className={`${FIELD_CLASS} w-full`}
        >
          {cardBorderStyleOptions(locale).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-card-border-opacity`}
        label={t("settings.borderOpacity")}
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
            className={CHECKBOX_CLASS}
            checked={usingCustomBorderColor}
            disabled={draft.cardBorderWidth === 0}
            onChange={(e) => {
              if (e.target.checked) {
                const computed = getComputedStyle(document.documentElement).getPropertyValue("--color-border").trim();
                onSaveNow({ cardBorderColor: computed || "#45403a" });
              } else {
                onSaveNow({ cardBorderColor: null });
              }
            }}
          />
          {t("settings.customBorderColor")}
        </label>
        {usingCustomBorderColor && (
          <ColorValueInput value={draft.cardBorderColor ?? "#45403a"} fallback="#45403a" onChange={(color) => onApply({ cardBorderColor: color })} />
        )}
      </div>
      {draft.cardBorderWidth === 0 && <p className="mt-1 text-xs text-(--color-text-dim)">{t("settings.borderWidthHint")}</p>}
    </Section>
  );
}

export function CardContentSection({ idPrefix, draft, onSaveNow }: CardStyleSectionProps) {
  const t = useT();
  return (
    <Section title={t("settings.cardContent")} wide>
      <ToggleRow
        id={`${idPrefix}-show-title-author`}
        label={t("settings.showTitleAuthor")}
        checked={draft.showTitleAuthor}
        hint={t("settings.showTitleAuthorHint")}
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
  const locale = useLocale();
  const t = useT();
  const usingCustomTextColor = draft.cardTextColor !== null;

  return (
    <Section title={t("settings.cardText")} wide>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-card-font-family`}>
          {t("settings.font")}
        </label>
        <select
          id={`${idPrefix}-card-font-family`}
          value={draft.cardFontFamily}
          onChange={(e) => onSaveNow({ cardFontFamily: e.target.value as CardFontFamily })}
          className={`${FIELD_CLASS} w-full`}
        >
          {cardFontFamilyOptions(locale).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-card-font-size`}
        label={t("settings.textSize")}
        value={draft.cardFontSize}
        range={CARD_FONT_SIZE_RANGE}
        onChange={(v) => onApply({ cardFontSize: v })}
      />

      <div className="mb-4 flex gap-4">
        <ToggleRow id={`${idPrefix}-card-bold`} label={t("settings.bold")} checked={draft.cardBold} onChange={(v) => onSaveNow({ cardBold: v })} />
        <ToggleRow id={`${idPrefix}-card-italic`} label={t("settings.italic")} checked={draft.cardItalic} onChange={(v) => onSaveNow({ cardItalic: v })} />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-custom-card-text-color-toggle`}>
          <input
            id={`${idPrefix}-custom-card-text-color-toggle`}
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={usingCustomTextColor}
            onChange={(e) => onSaveNow({ cardTextColor: e.target.checked ? "#ffffff" : null })}
          />
          {t("settings.customTextColor")}
        </label>
        {usingCustomTextColor && (
          <input
            type="color"
            value={draft.cardTextColor ?? "#ffffff"}
            onChange={(e) => onApply({ cardTextColor: e.target.value })}
            className="h-11 w-16 rounded border border-(--color-border) bg-transparent"
          />
        )}
      </div>
      <p className="mt-1 text-xs text-(--color-text-dim)">
        {t("settings.cardTextNote")}
      </p>
    </Section>
  );
}

type BlockBackgroundFields = "cardShadow" | "backgroundColor" | "backgroundFinish" | "gradientColor" | "gradientAngle" | "gradientStrength" | "innerSpacing";
type BlockEffectsFields = "cardOpacity" | "cardShadow" | "shadowColor" | "shadowOpacity" | "shadowBlur" | "shadowOffsetY" | "fadeColor" | "cardHoverEffect";

export function BlockBackgroundSection({
  idPrefix,
  draft,
  onApply,
  onSaveNow
}: {
  idPrefix: string;
  draft: Pick<BlockStyle, BlockBackgroundFields>;
  onApply: (patch: Partial<Pick<BlockStyle, BlockBackgroundFields>>) => void;
  onSaveNow: (patch: Partial<Pick<BlockStyle, BlockBackgroundFields>>) => void;
}) {
  const locale = useLocale();
  const t = useT();
  const transparent = draft.backgroundColor === "transparent";
  const usingCustomBackground = draft.backgroundColor !== null && !transparent;

  return (
    <Section title={t("settings.background")}>
      <label className="mb-3 flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-no-bg-toggle`}>
        <input
          id={`${idPrefix}-no-bg-toggle`}
          type="checkbox"
          className={CHECKBOX_CLASS}
          checked={transparent}
          onChange={(e) => onSaveNow(e.target.checked ? { backgroundColor: "transparent", cardShadow: false } : { backgroundColor: null })}
        />
        {t("settings.noBackground")}
      </label>
      <div className="mb-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-custom-bg-toggle`}>
          <input
            id={`${idPrefix}-custom-bg-toggle`}
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={usingCustomBackground}
            disabled={transparent}
            onChange={(e) => {
              if (e.target.checked) {
                const computed = getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim();
                onSaveNow({ backgroundColor: computed || "#ffffff" });
              } else {
                onSaveNow({ backgroundColor: null });
              }
            }}
          />
          {t("settings.customBackgroundColor")}
        </label>
        {usingCustomBackground && (
          <ColorValueInput value={draft.backgroundColor ?? "#ffffff"} fallback="#ffffff" onChange={(color) => onApply({ backgroundColor: color })} />
        )}
      </div>

      <ToggleRow id={`${idPrefix}-gradient`} label={t("settings.gradientBackground")} checked={draft.gradientColor !== null} onChange={(enabled) => onSaveNow({ gradientColor: enabled ? "theme:accent" : null, ...(enabled && transparent ? { backgroundColor: null } : {}) })} />
      {draft.gradientColor !== null ? <div className="mb-4 space-y-3">
        <p className="text-xs text-(--color-text-dim)">{t("settings.gradientFirstColor")}</p>
        <div className="flex items-center justify-between text-sm font-semibold"><span>{t("settings.secondColor")}</span><ColorValueInput label={t("settings.gradientSecondColor")} value={draft.gradientColor} fallback="#97532d" onChange={(gradientColor) => onApply({ gradientColor })} /></div>
        <SliderRow id={`${idPrefix}-gradient-direction`} label={t("settings.direction")} value={draft.gradientAngle} unit="°" range={BLOCK_GRADIENT_ANGLE_RANGE} onChange={(gradientAngle) => onApply({ gradientAngle })} />
        <SliderRow id={`${idPrefix}-gradient-strength`} label={t("settings.blendStrength")} value={draft.gradientStrength} unit="%" range={BLOCK_GRADIENT_STRENGTH_RANGE} onChange={(gradientStrength) => onApply({ gradientStrength })} />
      </div> : null}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-background-finish`}>
          {t("settings.finish")}
        </label>
        <select
          id={`${idPrefix}-background-finish`}
          value={draft.backgroundFinish}
          onChange={(e) => onSaveNow({ backgroundFinish: e.target.value as BlockBackgroundFinish })}
          className={`${FIELD_CLASS} w-full`}
        >
          {blockBackgroundFinishOptions(locale).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {transparent && <p className="mt-1 text-xs text-(--color-text-dim)">{t("settings.finishHint")}</p>}
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-inner-spacing`}>
          {t("settings.innerSpacing")}
        </label>
        <select
          id={`${idPrefix}-inner-spacing`}
          value={draft.innerSpacing}
          onChange={(e) => onSaveNow({ innerSpacing: e.target.value as BlockInnerSpacing })}
          className={`${FIELD_CLASS} w-full`}
        >
          {blockInnerSpacingOptions(locale).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

    </Section>
  );
}

export function BlockEffectsSection({ idPrefix, draft, onApply, onSaveNow }: {
  idPrefix: string;
  draft: Pick<BlockStyle, BlockEffectsFields>;
  onApply: (patch: Partial<Pick<BlockStyle, BlockEffectsFields>>) => void;
  onSaveNow: (patch: Partial<Pick<BlockStyle, BlockEffectsFields>>) => void;
}) {
  const t = useT();
  return <Section title={t("settings.effects")}>
      <SliderRow
        id={`${idPrefix}-block-opacity`}
        label={t("settings.blockOpacity")}
        value={draft.cardOpacity}
        unit="%"
        range={CARD_OPACITY_RANGE}
        onChange={(v) => onApply({ cardOpacity: v })}
      />

      <ToggleRow id={`${idPrefix}-block-shadow`} label={t("settings.dropShadow")} checked={draft.cardShadow} onChange={(v) => onSaveNow({ cardShadow: v })} />
      {draft.cardShadow ? <>
        <SliderRow id={`${idPrefix}-shadow-strength`} label={t("settings.shadowStrength")} value={draft.shadowOpacity} unit="%" range={BLOCK_SHADOW_OPACITY_RANGE} onChange={(shadowOpacity) => onApply({ shadowOpacity })} />
        <SliderRow id={`${idPrefix}-shadow-blur`} label={t("settings.shadowSoftness")} value={draft.shadowBlur} range={BLOCK_SHADOW_BLUR_RANGE} onChange={(shadowBlur) => onApply({ shadowBlur })} />
        <SliderRow id={`${idPrefix}-shadow-distance`} label={t("settings.shadowDistance")} value={draft.shadowOffsetY} range={BLOCK_SHADOW_OFFSET_RANGE} onChange={(shadowOffsetY) => onApply({ shadowOffsetY })} />
        <ToggleRow id={`${idPrefix}-shadow-color`} label={t("settings.customShadowColor")} checked={draft.shadowColor !== null} onChange={(enabled) => onSaveNow({ shadowColor: enabled ? "#000000" : null })} />
        {draft.shadowColor !== null ? <ColorValueInput label={t("settings.shadowColor")} value={draft.shadowColor} fallback="#000000" onChange={(shadowColor) => onApply({ shadowColor })} /> : null}
      </> : null}
      <ToggleRow id={`${idPrefix}-fade-color`} label={t("settings.fadeToColor")} checked={draft.fadeColor !== null} hint={t("settings.fadeHint")} onChange={(enabled) => onSaveNow({ fadeColor: enabled ? "#ffffff" : null })} />
      {draft.fadeColor !== null ? <ColorValueInput label={t("settings.fadeColor")} value={draft.fadeColor} fallback="#ffffff" onChange={(fadeColor) => onApply({ fadeColor })} /> : null}
      <ToggleRow
        id={`${idPrefix}-block-hover`}
        label={t("settings.hoverAnimation")}
        checked={draft.cardHoverEffect}
        hint={t("settings.blockHoverHint")}
        onChange={(v) => onSaveNow({ cardHoverEffect: v })}
      />
  </Section>;
}

type BlockTextFields = "fontFamily" | "fontSize" | "textColor" | "bold" | "italic" | "codeStyle" | "textAlign";

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
  const locale = useLocale();
  const t = useT();
  const usingCustomTextColor = draft.textColor !== null;

  return (
    <Section title={t("settings.blockText")} wide>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-font-family`}>
          {t("settings.font")}
        </label>
        <select
          id={`${idPrefix}-font-family`}
          value={draft.fontFamily}
          onChange={(e) => onSaveNow({ fontFamily: e.target.value as BlockFontFamily })}
          className={`${FIELD_CLASS} w-full`}
        >
          {blockFontFamilyOptions(locale).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <SliderRow
        id={`${idPrefix}-font-size`}
        label={t("settings.textSize")}
        value={draft.fontSize}
        range={BLOCK_FONT_SIZE_RANGE}
        onChange={(v) => onApply({ fontSize: v })}
      />

      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-text-align`}>
          {t("settings.alignment")}
        </label>
        <select
          id={`${idPrefix}-text-align`}
          value={draft.textAlign}
          onChange={(e) => onSaveNow({ textAlign: e.target.value as BlockTextAlign })}
          className={`${FIELD_CLASS} w-full`}
        >
          {blockTextAlignOptions(locale).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex gap-4">
        <ToggleRow id={`${idPrefix}-bold`} label={t("settings.bold")} checked={draft.bold} onChange={(v) => onSaveNow({ bold: v })} />
        <ToggleRow id={`${idPrefix}-italic`} label={t("settings.italic")} checked={draft.italic} onChange={(v) => onSaveNow({ italic: v })} />
      </div>
      <ToggleRow
        id={`${idPrefix}-code-style`}
        label={t("settings.codeStyle")}
        checked={draft.codeStyle}
        hint={t("settings.codeStyleHint")}
        onChange={(v) => onSaveNow({ codeStyle: v })}
      />

      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-custom-text-color-toggle`}>
          <input
            id={`${idPrefix}-custom-text-color-toggle`}
            type="checkbox"
            className={CHECKBOX_CLASS}
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
          {t("settings.customTextColor")}
        </label>
        {usingCustomTextColor && (
          <ColorValueInput value={draft.textColor ?? "#1a1a1a"} fallback="#1a1a1a" onChange={(color) => onApply({ textColor: color })} />
        )}
      </div>
      <p className="mt-1 text-xs text-(--color-text-dim)">{t("settings.blockTextNote")}</p>
    </Section>
  );
}
