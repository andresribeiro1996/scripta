import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  CARD_ASPECT_RATIO_OPTIONS, CARD_BORDER_OPACITY_RANGE, CARD_BORDER_STYLE_OPTIONS, CARD_BORDER_WIDTH_RANGE,
  CARD_FONT_FAMILY_OPTIONS, CARD_FONT_SIZE_RANGE, CARD_OPACITY_RANGE, CARD_RADIUS_RANGE, OVERLAY_INTENSITY_RANGE,
  type PerCardStyle,
} from "@scripta/shared";
import { Button } from "../../../ui";
import { Text } from "../../../ui/Text";
import { cardFontFamily, resolveBorderStyle } from "../../../ui/libraryStyle";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import {
  BORDER_SIDE_PRESETS, BORDER_STRENGTH_PRESETS, BORDER_STYLE_CHOICES, BORDER_WIDTH_PRESETS, CORNER_PRESETS, FADE_PRESETS,
  FRAME_LOOK_FIELDS, FRAME_LOOKS, matchPreset, matchSides,
} from "../../murals/blockStyleOptions";
import { Caption, Chip, ColorSwatchRow, PresetRow, Section, SelectRow, StepperRow, Tile } from "./StyleControls";
import { cardTextMayBeHardToRead } from "./scrim";

const TEXT_SIZES = [
  { key: "s", label: "S", value: 11 },
  { key: "m", label: "M", value: 13 },
  { key: "l", label: "L", value: 16 },
  { key: "xl", label: "XL", value: 20 },
];
const OVERLAY_PRESETS = [
  { key: "light", label: "Light", value: 40 },
  { key: "medium", label: "Medium", value: 72 },
  { key: "strong", label: "Strong", value: 88 },
  { key: "dark", label: "Dark", value: 100 },
];
const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

export function PerCardStyleFields({ draft, canvasColor, onApply, onSaveNow }: {
  draft: PerCardStyle;
  canvasColor: string;
  onApply: (patch: Partial<PerCardStyle>) => void;
  onSaveNow: (patch: Partial<PerCardStyle>) => void;
}) {
  const { colors } = useTheme();
  const [fineTune, setFineTune] = useState(false);
  return (
    <View style={styles.body}>
      <Section title="Looks">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrap}>
          {FRAME_LOOKS.map((look) => (
            <Tile key={look.key} label={look.label} selected={FRAME_LOOK_FIELDS.every((key) => key === "cardBorderSides" ? matchSides(draft[key]) === matchSides(look.style[key]) : draft[key] === look.style[key])} onPress={() => onSaveNow(look.style)}>
              <View style={[styles.look, { backgroundColor: colors.border, borderRadius: Math.min(look.style.cardRadius, radii.lg), borderColor: draft.cardBorderColor ?? colors.text, borderTopWidth: look.style.cardBorderSides.top ? look.style.cardBorderWidth : 0, borderRightWidth: look.style.cardBorderSides.right ? look.style.cardBorderWidth : 0, borderBottomWidth: look.style.cardBorderSides.bottom ? look.style.cardBorderWidth : 0, borderLeftWidth: look.style.cardBorderSides.left ? look.style.cardBorderWidth : 0, boxShadow: look.style.cardShadow ? "0 2px 4px rgba(0,0,0,0.2)" : undefined }]}>
                <Text style={{ color: colors.text, fontFamily: cardFontFamily(draft.cardFontFamily), fontSize: 12 }}>Aa</Text>
              </View>
            </Tile>
          ))}
        </ScrollView>
        <Caption>Changes the frame; keeps your cover and text choices.</Caption>
      </Section>
      <Section title="Cover">
        <SelectRow label="Shape" value={draft.cardAspectRatio} options={CARD_ASPECT_RATIO_OPTIONS} onChange={(cardAspectRatio) => onSaveNow({ cardAspectRatio })} />
        <SelectRow label="Title & author" value={draft.showTitleAuthor ? "show" : "hide"} options={[{ value: "show", label: "Show" }, { value: "hide", label: "Hide" }]} onChange={(value) => onSaveNow({ showTitleAuthor: value === "show" })} />
        <Caption>Books without a cover always show their title and author.</Caption>
        {draft.showTitleAuthor ? <PresetRow label="Text backdrop" presets={OVERLAY_PRESETS} value={draft.overlayIntensity} onChange={(overlayIntensity) => onSaveNow({ overlayIntensity })} /> : null}
      </Section>
      <Section title="Text">
        <View style={styles.wrap}>
          {CARD_FONT_FAMILY_OPTIONS.map((option) => <Chip key={option.value} label={option.label.replace(" (system)", "")} fontFamily={cardFontFamily(option.value)} selected={draft.cardFontFamily === option.value} onPress={() => onSaveNow({ cardFontFamily: option.value })} />)}
        </View>
        <PresetRow label="Size" presets={TEXT_SIZES} value={draft.cardFontSize} onChange={(cardFontSize) => onSaveNow({ cardFontSize })} />
        <View style={styles.wrap}>
          <Chip label="Bold" selected={draft.cardBold} onPress={() => onSaveNow({ cardBold: !draft.cardBold })} />
          <Chip label="Italic" selected={draft.cardItalic} onPress={() => onSaveNow({ cardItalic: !draft.cardItalic })} />
        </View>
        <ColorSwatchRow label="Text color" value={draft.cardTextColor} defaultColor="#ffffff" onChange={(cardTextColor) => onSaveNow({ cardTextColor })} />
        {cardTextMayBeHardToRead(draft, canvasColor) ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>Text may be hard to read over some covers. Try lighter text, a stronger backdrop, or less fade.</Text> : null}
      </Section>
      <Section title="Frame">
        <View style={styles.wrap}>
          {CORNER_PRESETS.map(({ key, label, value }) => <Tile key={key} label={label} selected={draft.cardRadius === value} onPress={() => onSaveNow({ cardRadius: value })}><View style={[styles.corner, { borderColor: colors.text, borderTopLeftRadius: value }]} /></Tile>)}
        </View>
        {matchPreset(CORNER_PRESETS, draft.cardRadius) === null ? <Caption>{`Custom corners · ${draft.cardRadius}px`}</Caption> : null}
        <PresetRow label="Width" presets={BORDER_WIDTH_PRESETS} value={draft.cardBorderWidth} onChange={(cardBorderWidth) => onSaveNow({ cardBorderWidth })} />
        {draft.cardBorderWidth > 0 ? <>
          <SelectRow label="Style" value={resolveBorderStyle(draft.cardBorderStyle)} options={BORDER_STYLE_CHOICES} onChange={(cardBorderStyle) => onSaveNow({ cardBorderStyle })} />
          {resolveBorderStyle(draft.cardBorderStyle) !== draft.cardBorderStyle ? <Caption>{`${CARD_BORDER_STYLE_OPTIONS.find((option) => option.value === draft.cardBorderStyle)?.label} is saved for web; displays as ${resolveBorderStyle(draft.cardBorderStyle)} here.`}</Caption> : null}
          <PresetRow label="Strength" presets={BORDER_STRENGTH_PRESETS} value={draft.cardBorderOpacity} onChange={(cardBorderOpacity) => onSaveNow({ cardBorderOpacity })} />
          <Text style={[typography.body, styles.label, { color: colors.text }]}>Sides</Text>
          <View style={styles.wrap}>
            {BORDER_SIDE_PRESETS.map(({ key, label, value }) => {
              const edge = (on: boolean) => on ? colors.text : colors.border;
              return <Tile key={key} label={label} selected={matchSides(draft.cardBorderSides) === key} onPress={() => onSaveNow({ cardBorderSides: value })}><View style={[styles.sides, { borderTopColor: edge(value.top), borderRightColor: edge(value.right), borderBottomColor: edge(value.bottom), borderLeftColor: edge(value.left) }]} /></Tile>;
            })}
          </View>
          <ColorSwatchRow label="Border color" value={draft.cardBorderColor} defaultColor={colors.border} onChange={(cardBorderColor) => onSaveNow({ cardBorderColor })} />
        </> : null}
        <SelectRow label="Shadow" value={draft.cardShadow ? "soft" : "none"} options={[{ value: "none", label: "None" }, { value: "soft", label: "Soft" }]} onChange={(value) => onSaveNow({ cardShadow: value === "soft" })} />
      </Section>
      <Section title="Fade & feedback">
        <PresetRow label="Fade" presets={FADE_PRESETS} value={draft.cardOpacity} onChange={(cardOpacity) => onSaveNow({ cardOpacity })} />
        <SelectRow label="Press feedback" value={draft.cardHoverEffect ? "on" : "off"} options={[{ value: "off", label: "None" }, { value: "on", label: "Subtle" }]} onChange={(value) => onSaveNow({ cardHoverEffect: value === "on" })} />
      </Section>
      <Button label={fineTune ? "Hide fine-tuning" : "Fine-tune"} variant="secondary" onPress={() => setFineTune(!fineTune)} />
      {fineTune ? <Section title="Exact values">
        <StepperRow label="Corners" value={draft.cardRadius} range={CARD_RADIUS_RANGE} onChange={(cardRadius) => onApply({ cardRadius })} />
        <StepperRow label="Text size" value={draft.cardFontSize} range={CARD_FONT_SIZE_RANGE} onChange={(cardFontSize) => onApply({ cardFontSize })} />
        <StepperRow label="Text backdrop" value={draft.overlayIntensity} range={OVERLAY_INTENSITY_RANGE} unit="%" onChange={(overlayIntensity) => onApply({ overlayIntensity })} />
        <StepperRow label="Card opacity" value={draft.cardOpacity} range={CARD_OPACITY_RANGE} unit="%" onChange={(cardOpacity) => onApply({ cardOpacity })} />
        <StepperRow label="Border width" value={draft.cardBorderWidth} range={CARD_BORDER_WIDTH_RANGE} onChange={(cardBorderWidth) => onApply({ cardBorderWidth })} />
        <StepperRow label="Border strength" value={draft.cardBorderOpacity} range={CARD_BORDER_OPACITY_RANGE} unit="%" onChange={(cardBorderOpacity) => onApply({ cardBorderOpacity })} />
        <View style={styles.wrap}>{BORDER_SIDES.map((side) => <Chip key={side} label={side[0].toUpperCase() + side.slice(1)} selected={draft.cardBorderSides[side]} onPress={() => onSaveNow({ cardBorderSides: { ...draft.cardBorderSides, [side]: !draft.cardBorderSides[side] } })} />)}</View>
      </Section> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.xl },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { fontWeight: "600" },
  look: { width: 28, height: 38, alignItems: "center", justifyContent: "center" },
  corner: { width: 36, height: 26, borderTopWidth: 2, borderLeftWidth: 2 },
  sides: { width: 32, height: 22, borderWidth: 2 },
});
