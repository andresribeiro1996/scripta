import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  cardAspectRatioOptions, CARD_BORDER_OPACITY_RANGE, cardBorderStyleOptions, CARD_BORDER_WIDTH_RANGE,
  cardFontFamilyOptions, CARD_FONT_SIZE_RANGE, CARD_OPACITY_RANGE, CARD_RADIUS_RANGE, OVERLAY_INTENSITY_RANGE,
  type PerCardStyle,
} from "@scripta/shared";
import { Button } from "../../../ui";
import { Text } from "../../../ui/Text";
import { cardFontFamily, resolveBorderStyle } from "../../../ui/libraryStyle";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import {
  BORDER_SIDE_PRESETS, BORDER_STRENGTH_PRESETS, BORDER_WIDTH_PRESETS, CORNER_PRESETS, FADE_PRESETS,
  FRAME_LOOK_FIELDS, FRAME_LOOKS, borderStyleChoices, matchPreset, matchSides, presetOptions,
} from "../../murals/blockStyleOptions";
import { Caption, Chip, ColorSwatchRow, PresetRow, SelectRow, StepperRow, Tile } from "./StyleControls";
import { cardTextMayBeHardToRead } from "./scrim";
import { useLocale, useT, type MobileMessages } from "../../../i18n";

const TEXT_SIZES = [
  { key: "s", label: "S", value: 11 },
  { key: "m", label: "M", value: 13 },
  { key: "l", label: "L", value: 16 },
  { key: "xl", label: "XL", value: 20 },
];
const OVERLAY_PRESETS: readonly { key: string; labelKey: Extract<keyof MobileMessages, string>; value: number }[] = [
  { key: "light", labelKey: "library.overlayLight", value: 40 },
  { key: "medium", labelKey: "library.overlayMedium", value: 72 },
  { key: "strong", labelKey: "library.overlayStrong", value: 88 },
  { key: "dark", labelKey: "library.overlayDark", value: 100 },
];
const BORDER_SIDES = [
  { side: "top", labelKey: "library.sideTop" },
  { side: "right", labelKey: "library.sideRight" },
  { side: "bottom", labelKey: "library.sideBottom" },
  { side: "left", labelKey: "library.sideLeft" },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{title}</Text>
      {children}
    </View>
  );
}

export function PerCardStyleFields({ draft, canvasColor, onApply, onSaveNow }: {
  draft: PerCardStyle;
  canvasColor: string;
  onApply: (patch: Partial<PerCardStyle>) => void;
  onSaveNow: (patch: Partial<PerCardStyle>) => void;
}) {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const [fineTune, setFineTune] = useState(false);
  return (
    <View style={styles.body}>
      <Section title={t("library.sectionLooks")}>
        <View style={styles.looks}>
          {FRAME_LOOKS.map((look) => (
            <Tile key={look.key} label={t(look.labelKey)} width="30%" selected={FRAME_LOOK_FIELDS.every((key) => key === "cardBorderSides" ? matchSides(draft[key]) === matchSides(look.style[key]) : draft[key] === look.style[key])} onPress={() => onSaveNow(look.style)}>
              <View style={[styles.look, { backgroundColor: colors.border, borderRadius: Math.min(look.style.cardRadius, radii.lg), borderColor: draft.cardBorderColor ?? colors.text, borderTopWidth: look.style.cardBorderSides.top ? look.style.cardBorderWidth : 0, borderRightWidth: look.style.cardBorderSides.right ? look.style.cardBorderWidth : 0, borderBottomWidth: look.style.cardBorderSides.bottom ? look.style.cardBorderWidth : 0, borderLeftWidth: look.style.cardBorderSides.left ? look.style.cardBorderWidth : 0, boxShadow: look.style.cardShadow ? "0 2px 4px rgba(0,0,0,0.2)" : undefined }]}>
                <Text style={{ color: colors.text, fontFamily: cardFontFamily(draft.cardFontFamily), fontSize: 12 }}>Aa</Text>
              </View>
            </Tile>
          ))}
        </View>
        <Caption>{t("library.looksNote")}</Caption>
      </Section>
      <Section title={t("shell.cover")}>
        <View style={styles.looks}>
          {cardAspectRatioOptions(locale).map((option) => (
            <Tile key={option.value} label={option.label} width="30%" selected={draft.cardAspectRatio === option.value} onPress={() => onSaveNow({ cardAspectRatio: option.value })}>
              <View style={{ width: 24, aspectRatio: option.value, borderWidth: 1, borderRadius: radii.sm, borderColor: colors.text }} />
            </Tile>
          ))}
        </View>
        <SelectRow label={t("library.titleAuthor")} value={draft.showTitleAuthor ? "show" : "hide"} options={[{ value: "show", label: t("library.show") }, { value: "hide", label: t("library.hide") }]} onChange={(value) => onSaveNow({ showTitleAuthor: value === "show" })} />
        <Caption>{t("library.titleAuthorNote")}</Caption>
        {draft.showTitleAuthor ? <PresetRow label={t("library.textBackdrop")} presets={OVERLAY_PRESETS.map((preset) => ({ key: preset.key, label: t(preset.labelKey), value: preset.value }))} value={draft.overlayIntensity} onChange={(overlayIntensity) => onSaveNow({ overlayIntensity })} /> : null}
      </Section>
      <Section title={t("library.sectionText")}>
        <View style={styles.wrap}>
          {cardFontFamilyOptions(locale).map((option) => <Chip key={option.value} label={option.shortLabel} fontFamily={cardFontFamily(option.value)} selected={draft.cardFontFamily === option.value} onPress={() => onSaveNow({ cardFontFamily: option.value })} />)}
        </View>
        <PresetRow label={t("library.size")} presets={TEXT_SIZES} value={draft.cardFontSize} onChange={(cardFontSize) => onSaveNow({ cardFontSize })} />
        <View style={styles.wrap}>
          <Chip label={t("library.bold")} selected={draft.cardBold} onPress={() => onSaveNow({ cardBold: !draft.cardBold })} />
          <Chip label={t("library.italic")} selected={draft.cardItalic} onPress={() => onSaveNow({ cardItalic: !draft.cardItalic })} />
        </View>
        <ColorSwatchRow label={t("library.textColor")} value={draft.cardTextColor} defaultColor="#ffffff" onChange={(cardTextColor) => onSaveNow({ cardTextColor })} />
        {cardTextMayBeHardToRead(draft, canvasColor) ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>{t("library.hardToRead")}</Text> : null}
      </Section>
      <Section title={t("library.sectionFrame")}>
        <View style={styles.wrap}>
          {presetOptions(CORNER_PRESETS, locale).map(({ key, label, value }) => <Tile key={key} label={label} selected={draft.cardRadius === value} onPress={() => onSaveNow({ cardRadius: value })}><View style={[styles.corner, { borderColor: colors.text, borderTopLeftRadius: value }]} /></Tile>)}
        </View>
        {matchPreset(CORNER_PRESETS, draft.cardRadius) === null ? <Caption>{t("library.customCorners", { radius: draft.cardRadius })}</Caption> : null}
        <PresetRow label={t("library.width")} presets={presetOptions(BORDER_WIDTH_PRESETS, locale)} value={draft.cardBorderWidth} onChange={(cardBorderWidth) => onSaveNow({ cardBorderWidth })} />
        {draft.cardBorderWidth > 0 ? <>
          <SelectRow label={t("library.style")} value={resolveBorderStyle(draft.cardBorderStyle)} options={borderStyleChoices(locale)} onChange={(cardBorderStyle) => onSaveNow({ cardBorderStyle })} />
          {resolveBorderStyle(draft.cardBorderStyle) !== draft.cardBorderStyle ? <Caption>{t("library.borderSavedForWeb", { style: cardBorderStyleOptions(locale).find((option) => option.value === draft.cardBorderStyle)?.label ?? draft.cardBorderStyle, shown: cardBorderStyleOptions(locale).find((option) => option.value === resolveBorderStyle(draft.cardBorderStyle))?.label.toLowerCase() ?? resolveBorderStyle(draft.cardBorderStyle) })}</Caption> : null}
          <PresetRow label={t("library.strength")} presets={presetOptions(BORDER_STRENGTH_PRESETS, locale)} value={draft.cardBorderOpacity} onChange={(cardBorderOpacity) => onSaveNow({ cardBorderOpacity })} />
          <Text style={[typography.body, styles.label, { color: colors.text }]}>{t("library.sides")}</Text>
          <View style={styles.wrap}>
            {presetOptions(BORDER_SIDE_PRESETS, locale).map(({ key, label, value }) => {
              const edge = (on: boolean) => on ? colors.text : colors.border;
              return <Tile key={key} label={label} width={88} selected={matchSides(draft.cardBorderSides) === key} onPress={() => onSaveNow({ cardBorderSides: value })}><View style={[styles.sides, { borderTopColor: edge(value.top), borderRightColor: edge(value.right), borderBottomColor: edge(value.bottom), borderLeftColor: edge(value.left) }]} /></Tile>;
            })}
          </View>
          <ColorSwatchRow label={t("library.borderColor")} value={draft.cardBorderColor} defaultColor={colors.border} onChange={(cardBorderColor) => onSaveNow({ cardBorderColor })} />
        </> : null}
        <SelectRow label={t("library.shadow")} value={draft.cardShadow ? "soft" : "none"} options={[{ value: "none", label: t("library.none") }, { value: "soft", label: t("library.soft") }]} onChange={(value) => onSaveNow({ cardShadow: value === "soft" })} />
      </Section>
      <Section title={t("library.sectionFadeFeedback")}>
        <PresetRow label={t("library.fade")} presets={presetOptions(FADE_PRESETS, locale)} value={draft.cardOpacity} onChange={(cardOpacity) => onSaveNow({ cardOpacity })} />
        <SelectRow label={t("library.pressFeedback")} value={draft.cardHoverEffect ? "on" : "off"} options={[{ value: "off", label: t("library.none") }, { value: "on", label: t("library.subtle") }]} onChange={(value) => onSaveNow({ cardHoverEffect: value === "on" })} />
      </Section>
      <Button label={fineTune ? t("library.hideFineTuning") : t("library.fineTune")} variant="secondary" onPress={() => setFineTune(!fineTune)} />
      {fineTune ? <Section title={t("library.sectionExactValues")}>
        <StepperRow label={t("library.corners")} value={draft.cardRadius} range={CARD_RADIUS_RANGE} onChange={(cardRadius) => onApply({ cardRadius })} />
        <StepperRow label={t("library.textSize")} value={draft.cardFontSize} range={CARD_FONT_SIZE_RANGE} onChange={(cardFontSize) => onApply({ cardFontSize })} />
        <StepperRow label={t("library.textBackdrop")} value={draft.overlayIntensity} range={OVERLAY_INTENSITY_RANGE} unit="%" onChange={(overlayIntensity) => onApply({ overlayIntensity })} />
        <StepperRow label={t("library.cardOpacity")} value={draft.cardOpacity} range={CARD_OPACITY_RANGE} unit="%" onChange={(cardOpacity) => onApply({ cardOpacity })} />
        <StepperRow label={t("library.borderWidth")} value={draft.cardBorderWidth} range={CARD_BORDER_WIDTH_RANGE} onChange={(cardBorderWidth) => onApply({ cardBorderWidth })} />
        <StepperRow label={t("library.borderStrength")} value={draft.cardBorderOpacity} range={CARD_BORDER_OPACITY_RANGE} unit="%" onChange={(cardBorderOpacity) => onApply({ cardBorderOpacity })} />
        <View style={styles.wrap}>{BORDER_SIDES.map(({ side, labelKey }) => <Chip key={side} label={t(labelKey)} selected={draft.cardBorderSides[side]} onPress={() => onSaveNow({ cardBorderSides: { ...draft.cardBorderSides, [side]: !draft.cardBorderSides[side] } })} />)}</View>
      </Section> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  section: { gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderRadius: radii.lg },
  looks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { fontWeight: "600" },
  look: { width: 28, height: 38, alignItems: "center", justifyContent: "center" },
  corner: { width: 36, height: 26, borderTopWidth: 2, borderLeftWidth: 2 },
  sides: { width: 32, height: 22, borderWidth: 2 },
});
