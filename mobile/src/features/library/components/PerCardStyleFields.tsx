// The native equivalent of frontend's CardAppearanceSection/
// CardBorderSection/CardContentSection/CardTextSection (components/
// StyleControls.tsx) collapsed into one component — used by both
// LibraryStyleView.tsx (the full library-wide panel) and
// PerCardStyleForm.tsx (a series/book override), same as the web
// version reuses the same four sections in both places.

import { View } from "react-native";
import {
  CARD_ASPECT_RATIO_OPTIONS,
  CARD_BORDER_OPACITY_RANGE,
  CARD_BORDER_STYLE_OPTIONS,
  CARD_BORDER_WIDTH_RANGE,
  CARD_FONT_FAMILY_OPTIONS,
  CARD_FONT_SIZE_RANGE,
  CARD_OPACITY_RANGE,
  CARD_RADIUS_RANGE,
  OVERLAY_INTENSITY_RANGE,
  type CardAspectRatio,
  type CardBorderStyle,
  type CardFontFamily,
  type PerCardStyle,
} from "@scripta/shared";
import { spacing } from "../../../ui/theme";
import { ColorSwatchRow, Section, SelectRow, StepperRow, ToggleRow } from "./StyleControls";

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

export function PerCardStyleFields({
  draft,
  onApply,
  onSaveNow,
  themeBorderColor,
}: {
  draft: PerCardStyle;
  /** Debounced (StepperRow/ColorSwatchRow drags) — see lib/debounce.ts. */
  onApply: (patch: Partial<PerCardStyle>) => void;
  /** Immediate (toggles/selects). */
  onSaveNow: (patch: Partial<PerCardStyle>) => void;
  themeBorderColor: string;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <Section title="Card appearance">
        <StepperRow label="Corner radius" value={draft.cardRadius} range={CARD_RADIUS_RANGE} onChange={(v) => onApply({ cardRadius: v })} />
        <SelectRow
          label="Cover shape"
          value={draft.cardAspectRatio}
          options={CARD_ASPECT_RATIO_OPTIONS.map((o) => ({ value: o.value as CardAspectRatio, label: o.label }))}
          onChange={(v) => onSaveNow({ cardAspectRatio: v })}
        />
        <StepperRow
          label="Text overlay darkness"
          value={draft.overlayIntensity}
          unit="%"
          range={OVERLAY_INTENSITY_RANGE}
          onChange={(v) => onApply({ overlayIntensity: v })}
        />
        <StepperRow label="Card opacity" value={draft.cardOpacity} unit="%" range={CARD_OPACITY_RANGE} onChange={(v) => onApply({ cardOpacity: v })} />
        <ToggleRow label="Drop shadow" checked={draft.cardShadow} onChange={(v) => onSaveNow({ cardShadow: v })} />
        <ToggleRow
          label="Press feedback"
          hint="Dims and shrinks slightly on tap — the touch equivalent of the web's hover animation."
          checked={draft.cardHoverEffect}
          onChange={(v) => onSaveNow({ cardHoverEffect: v })}
        />
      </Section>

      <Section title="Card border">
        <StepperRow label="Border width" value={draft.cardBorderWidth} range={CARD_BORDER_WIDTH_RANGE} onChange={(v) => onApply({ cardBorderWidth: v })} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
          {BORDER_SIDES.map((side) => (
            <ToggleRow
              key={side}
              label={side[0].toUpperCase() + side.slice(1)}
              checked={draft.cardBorderSides[side]}
              onChange={(v) => onSaveNow({ cardBorderSides: { ...draft.cardBorderSides, [side]: v } })}
            />
          ))}
        </View>
        <SelectRow
          label="Border style"
          value={draft.cardBorderStyle}
          options={CARD_BORDER_STYLE_OPTIONS.map((o) => ({ value: o.value as CardBorderStyle, label: o.label }))}
          onChange={(v) => onSaveNow({ cardBorderStyle: v })}
        />
        <StepperRow
          label="Border opacity"
          value={draft.cardBorderOpacity}
          unit="%"
          range={CARD_BORDER_OPACITY_RANGE}
          onChange={(v) => onApply({ cardBorderOpacity: v })}
        />
        <ColorSwatchRow
          label="Custom border color"
          value={draft.cardBorderColor}
          defaultColor={themeBorderColor}
          onEnable={() => onSaveNow({ cardBorderColor: themeBorderColor })}
          onChange={(color) => onApply({ cardBorderColor: color })}
          onDisable={() => onSaveNow({ cardBorderColor: null })}
        />
      </Section>

      <Section title="Card content">
        <ToggleRow
          label="Show title and author on cards"
          hint="Always shown for a book with no cover."
          checked={draft.showTitleAuthor}
          onChange={(v) => onSaveNow({ showTitleAuthor: v })}
        />
      </Section>

      <Section title="Card text">
        <SelectRow
          label="Font"
          value={draft.cardFontFamily}
          options={CARD_FONT_FAMILY_OPTIONS.map((o) => ({ value: o.value as CardFontFamily, label: o.label }))}
          onChange={(v) => onSaveNow({ cardFontFamily: v })}
        />
        <StepperRow label="Text size" value={draft.cardFontSize} range={CARD_FONT_SIZE_RANGE} onChange={(v) => onApply({ cardFontSize: v })} />
        <View style={{ flexDirection: "row", gap: spacing.lg }}>
          <ToggleRow label="Bold" checked={draft.cardBold} onChange={(v) => onSaveNow({ cardBold: v })} />
          <ToggleRow label="Italic" checked={draft.cardItalic} onChange={(v) => onSaveNow({ cardItalic: v })} />
        </View>
        <ColorSwatchRow
          label="Custom text color"
          value={draft.cardTextColor}
          defaultColor="#ffffff"
          onEnable={() => onSaveNow({ cardTextColor: "#ffffff" })}
          onChange={(color) => onApply({ cardTextColor: color })}
          onDisable={() => onSaveNow({ cardTextColor: null })}
        />
      </Section>
    </View>
  );
}
