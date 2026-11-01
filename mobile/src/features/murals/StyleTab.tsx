import { blockBackgroundFinishOptions, blockFontFamilyOptions, cardBorderStyleOptions, blockInnerSpacingOptions, blockTextAlignOptions, blockThemeColorLabels, normalizeHexColor, resolveBlockColor, themeColorRef, type BlockStyle, type BlockThemeColorKey } from "@scripta/shared";
import { Collapsible, Host, RNHostView } from "@expo/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button, Icon } from "../../ui";
import { Text } from "../../ui/Text";
import { blockFontFamily, resolveBorderStyle } from "../../ui/libraryStyle";
import { minimumTouchTarget, radii, spacing, typography, useTheme, type ThemeColors } from "../../ui/theme";
import { Caption, Chip, PresetRow, SelectRow, SWATCHES, Tile } from "../library/components/StyleControls";
import { ColorEditor } from "./ColorEditor";
import { SavedLooks } from "./SavedLooks";
import {
  BACKGROUND_FIXED_SWATCHES, BACKGROUND_THEME_SWATCHES, BORDER_SIDE_PRESETS, BORDER_STRENGTH_PRESETS, BORDER_THEME_SWATCHES,
  BORDER_WIDTH_PRESETS, COLOR_LOOKS, CORNER_PRESETS, FADE_PRESETS, FRAME_LOOKS, GRADIENT_DIRECTION_PRESETS, GRADIENT_STRENGTH_PRESETS, SHADOW_BLUR_PRESETS, SHADOW_DISTANCE_PRESETS, SHADOW_STRENGTH_PRESETS, SIZE_PRESETS, TEXT_THEME_SWATCHES,
  applyLook, borderStyleChoices, customColorStart, isHardToRead, matchSides, presetOptions, type CustomColorTarget, type Look,
} from "./blockStyleOptions";
import { useLocale, useT } from "../../i18n";

const COLLAPSIBLE_CONTENT_INSET = 32;

function Group({ title, open, onOpenChange, width, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; width?: number; children: ReactNode }) {
  const { colors, mode } = useTheme();
  return (
    <Host matchContents={{ vertical: true }} colorScheme={mode} seedColor={colors.accent}>
      <Collapsible label={title} labelStyle={{ color: colors.text, fontSize: 16, fontWeight: "600" }} isOpen={open} onOpenChange={onOpenChange}>
        <RNHostView matchContents><View style={[styles.group, { width }]}>{children}</View></RNHostView>
      </Collapsible>
    </Host>
  );
}

function ColorRow({ label, palette, value, defaults, themeKeys, fixed, onChange, onCustom, editor }: {
  label: string;
  palette: ThemeColors;
  value: string | null;
  defaults: Array<{ label: string; value: string | null }>;
  themeKeys: readonly BlockThemeColorKey[];
  fixed: readonly string[];
  onChange: (value: string | null) => void;
  onCustom: () => void;
  editor: ReactNode;
}) {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const current = value?.toLowerCase() ?? null;
  const swatch = (key: string, accessibilityLabel: string, fill: string, stored: string) => {
    const selected = current === stored.toLowerCase();
    return <Pressable key={key} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected }} onPress={() => onChange(stored)} style={[styles.swatch, { backgroundColor: fill, borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 3 : 1 }]} />;
  };
  const custom = current && normalizeHexColor(current) && !fixed.some((hex) => hex.toLowerCase() === current) ? current : null;
  return (
    <View style={styles.colorRow}>
      <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.wrap}>{defaults.map((option) => <Chip key={option.label} label={option.label} selected={value === option.value} onPress={() => onChange(option.value)} />)}</View>
      <Caption>{t("murals.themeFollows")}</Caption>
      <View style={styles.wrap}>{themeKeys.map((key) => swatch(key, t("murals.themeColorLabel", { name: blockThemeColorLabels(locale)[key] }), palette[key], themeColorRef(key)))}</View>
      <Caption>{t("murals.fixed")}</Caption>
      <View style={styles.wrap}>{fixed.map((hex) => swatch(hex, t("murals.useColor", { color: hex }), hex, hex))}
        <Pressable accessibilityRole="button" accessibilityLabel={custom ? t("murals.customColorValue", { value: custom }) : t("murals.customColor")} accessibilityState={{ selected: custom !== null }} onPress={onCustom} style={[styles.swatch, styles.custom, { backgroundColor: custom ?? colors.surface, borderColor: custom ? colors.accent : colors.border, borderWidth: custom ? 3 : 1 }]}>
          {custom ? null : <Icon name="add" size={20} color={colors.text} />}
        </Pressable>
      </View>
      {editor}
    </View>
  );
}

function LookCard({ look, style, palette, onPress }: { look: Look; style: BlockStyle; palette: ThemeColors; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const preview = applyLook(style, look);
  const background = resolveBlockColor(preview.backgroundColor, palette) ?? palette.surface;
  const text = resolveBlockColor(preview.textColor, palette) ?? palette.text;
  const border = resolveBlockColor(preview.cardBorderColor, palette) ?? palette.border;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("murals.applyLook", { label: t(look.labelKey) })} onPress={onPress} style={styles.lookWrap}>
      <View style={[styles.look, { backgroundColor: background, borderColor: preview.cardBorderWidth ? border : palette.border, borderWidth: Math.max(1, preview.cardBorderWidth), borderStyle: preview.cardBorderWidth ? "solid" : "dashed", borderRadius: Math.min(preview.cardRadius, radii.lg) }]}>
        <Text style={{ color: text, fontFamily: blockFontFamily(preview.fontFamily), fontWeight: preview.bold ? "700" : "400", fontSize: 16 }}>Aa</Text>
      </View>
      <Text style={[typography.caption, { color: colors.textDim, alignSelf: "stretch", textAlign: "center" }]}>{t(look.labelKey)}</Text>
    </Pressable>
  );
}

export function StyleTab({ style, palette, onChange, onReset, onCopy, onPaste, canPaste }: {
  style: BlockStyle;
  palette: ThemeColors;
  onChange: (style: BlockStyle) => void;
  onReset: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
}) {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const set = (patch: Partial<BlockStyle>) => onChange({ ...style, ...patch });
  const [section, setSection] = useState<string | null>("background");
  const [tabWidth, setTabWidth] = useState(0);
  const groupWidth = Platform.OS === "android" && tabWidth > 0 ? tabWidth - COLLAPSIBLE_CONTENT_INSET : undefined;
  const [editing, setEditing] = useState<{ target: CustomColorTarget; previous: string | null } | null>(null);
  const latest = useRef({ style, onChange, editing });
  latest.current = { style, onChange, editing };
  useEffect(() => () => {
    const { style: current, onChange: change, editing: open } = latest.current;
    if (open) change({ ...current, [open.target]: open.previous });
  }, []);
  const group = (id: string, title: string) => ({
    title,
    width: groupWidth,
    open: section === id,
    onOpenChange: (open: boolean) => {
      if (editing) { set({ [editing.target]: editing.previous }); setEditing(null); }
      setSection(open ? id : null);
    },
  });
  const customRow = (target: CustomColorTarget) => ({
    onCustom: () => { if (editing?.target !== target) setEditing({ target, previous: style[target] }); },
    editor: editing?.target === target ? (
      <ColorEditor
        key={target}
        color={customColorStart(target, style, palette)}
        onChange={(hex) => set({ [target]: hex })}
        onDone={() => setEditing(null)}
        onCancel={() => { set({ [target]: editing.previous }); setEditing(null); }}
      />
    ) : null,
  });
  const looks = (catalog: readonly Look[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.looks}>
      {catalog.map((look) => <LookCard key={look.key} look={look} style={style} palette={palette} onPress={() => onChange(applyLook(style, look))} />)}
    </ScrollView>
  );
  return (
    <View style={styles.tab} onLayout={(event) => setTabWidth(event.nativeEvent.layout.width)}>
      <Group {...group("background", t("murals.background"))}>
        <ColorRow palette={palette} label={t("murals.background")} value={style.backgroundColor} defaults={[{ label: t("murals.presetNone"), value: "transparent" }, { label: t("settings.theme"), value: null }]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={BACKGROUND_FIXED_SWATCHES} onChange={(backgroundColor) => set(backgroundColor === "transparent" ? { backgroundColor, cardShadow: false } : { backgroundColor })} {...customRow("backgroundColor")} />
        <SelectRow label={t("murals.gradient")} value={style.gradientColor ? "on" : "none"} options={[{ value: "none", label: t("murals.presetNone") }, { value: "on", label: t("tierlists.on") }]} onChange={(value) => set({ gradientColor: value === "on" ? themeColorRef("accent") : null, ...(value === "on" && style.backgroundColor === "transparent" ? { backgroundColor: null } : {}) })} />
        {style.gradientColor ? <>
          <Caption>{t("murals.gradientFirstColor")}</Caption>
          <ColorRow palette={palette} label={t("murals.secondColor")} value={style.gradientColor} defaults={[]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={BACKGROUND_FIXED_SWATCHES} onChange={(gradientColor) => set({ gradientColor })} {...customRow("gradientColor")} />
          <PresetRow label={t("murals.direction")} presets={presetOptions(GRADIENT_DIRECTION_PRESETS, locale)} value={style.gradientAngle} onChange={(gradientAngle) => set({ gradientAngle })} />
          <PresetRow label={t("murals.blendStrength")} presets={presetOptions(GRADIENT_STRENGTH_PRESETS, locale)} value={style.gradientStrength} onChange={(gradientStrength) => set({ gradientStrength })} />
        </> : null}
        <SelectRow label={t("murals.finish")} value={style.backgroundFinish} options={blockBackgroundFinishOptions(locale)} onChange={(backgroundFinish) => set({ backgroundFinish })} />
        {style.backgroundColor === "transparent" ? <Caption>{t("murals.finishNeedsBackground")}</Caption> : null}
        <SelectRow label={t("murals.innerSpacing")} value={style.innerSpacing} options={blockInnerSpacingOptions(locale)} onChange={(innerSpacing) => set({ innerSpacing })} />
      </Group>
      <Group {...group("text", t("library.sectionText"))}>
        <ColorRow palette={palette} label={t("library.textColor")} value={style.textColor} defaults={[{ label: t("library.auto"), value: null }]} themeKeys={TEXT_THEME_SWATCHES} fixed={SWATCHES} onChange={(textColor) => set({ textColor })} {...customRow("textColor")} />
        {isHardToRead(style, palette) ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>{t("murals.hardToRead")}</Text> : null}

        <View style={styles.wrap}>
          {blockFontFamilyOptions(locale).map((option) => <Chip key={option.value} label={option.shortLabel} fontFamily={blockFontFamily(option.value)} selected={style.fontFamily === option.value} onPress={() => set({ fontFamily: option.value })} />)}
        </View>
        <PresetRow label={t("library.size")} presets={SIZE_PRESETS} value={style.fontSize} onChange={(fontSize) => set({ fontSize })} />
        <View style={styles.wrap}>
          <Chip label={t("library.bold")} selected={style.bold} onPress={() => set({ bold: !style.bold })} />
          <Chip label={t("library.italic")} selected={style.italic} onPress={() => set({ italic: !style.italic })} />
          <Chip label={t("murals.code")} selected={style.codeStyle} onPress={() => set({ codeStyle: !style.codeStyle })} />
        </View>
        <SelectRow label={t("murals.alignment")} value={style.textAlign} options={blockTextAlignOptions(locale)} onChange={(textAlign) => set({ textAlign })} />
      </Group>
      <Group {...group("border", t("murals.border"))}>
        <View style={styles.wrap}>
          {presetOptions(CORNER_PRESETS, locale).map(({ key, label, value: radius }) => (
            <Tile key={key} label={label} selected={style.cardRadius === radius} onPress={() => set({ cardRadius: radius })}>
              <View style={[styles.corner, { borderColor: colors.text, borderTopLeftRadius: radius }]} />
            </Tile>
          ))}
        </View>
        <PresetRow label={t("library.width")} presets={presetOptions(BORDER_WIDTH_PRESETS, locale)} value={style.cardBorderWidth} onChange={(cardBorderWidth) => set({ cardBorderWidth })} />
        {style.cardBorderWidth > 0 ? <>
          <SelectRow label={t("library.style")} value={resolveBorderStyle(style.cardBorderStyle)} options={borderStyleChoices(locale)} onChange={(cardBorderStyle) => set({ cardBorderStyle })} />
          {resolveBorderStyle(style.cardBorderStyle) !== style.cardBorderStyle ? <Caption>{t("library.borderSavedForWeb", { style: cardBorderStyleOptions(locale).find((option) => option.value === style.cardBorderStyle)?.label ?? style.cardBorderStyle, shown: cardBorderStyleOptions(locale).find((option) => option.value === resolveBorderStyle(style.cardBorderStyle))?.label.toLowerCase() ?? resolveBorderStyle(style.cardBorderStyle) })}</Caption> : null}
          <PresetRow label={t("library.strength")} presets={presetOptions(BORDER_STRENGTH_PRESETS, locale)} value={style.cardBorderOpacity} onChange={(cardBorderOpacity) => set({ cardBorderOpacity })} />
          <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>{t("library.sides")}</Text>
          <View style={styles.wrap}>
            {presetOptions(BORDER_SIDE_PRESETS, locale).map(({ key, label, value: sides }) => {
              const edge = (on: boolean) => (on ? colors.text : colors.border);
              return (
                <Tile key={key} label={label} width={88} selected={matchSides(style.cardBorderSides) === key} onPress={() => set({ cardBorderSides: sides })}>
                  <View style={[styles.sides, { borderTopColor: edge(sides.top), borderRightColor: edge(sides.right), borderBottomColor: edge(sides.bottom), borderLeftColor: edge(sides.left) }]} />
                </Tile>
              );
            })}
          </View>
          <ColorRow palette={palette} label={t("library.borderColor")} value={style.cardBorderColor} defaults={[{ label: t("library.auto"), value: null }]} themeKeys={BORDER_THEME_SWATCHES} fixed={SWATCHES} onChange={(cardBorderColor) => set({ cardBorderColor })} {...customRow("cardBorderColor")} />
        </> : null}
      </Group>
      <Group {...group("effects", t("murals.effects"))}>
        <SelectRow label={t("library.shadow")} value={style.cardShadow ? "on" : "none"} options={[{ value: "none", label: t("library.none") }, { value: "on", label: t("murals.shadowOn") }]} onChange={(value) => set({ cardShadow: value === "on" })} />
        {style.cardShadow ? <>
          <PresetRow label={t("murals.shadowStrength")} presets={presetOptions(SHADOW_STRENGTH_PRESETS, locale)} value={style.shadowOpacity} onChange={(shadowOpacity) => set({ shadowOpacity })} />
          <PresetRow label={t("murals.shadowSoftness")} presets={presetOptions(SHADOW_BLUR_PRESETS, locale)} value={style.shadowBlur} onChange={(shadowBlur) => set({ shadowBlur })} />
          <PresetRow label={t("murals.shadowDistance")} presets={presetOptions(SHADOW_DISTANCE_PRESETS, locale)} value={style.shadowOffsetY} onChange={(shadowOffsetY) => set({ shadowOffsetY })} />
          <ColorRow palette={palette} label={t("murals.shadowColor")} value={style.shadowColor} defaults={[{ label: t("murals.black"), value: null }]} themeKeys={BORDER_THEME_SWATCHES} fixed={SWATCHES} onChange={(shadowColor) => set({ shadowColor })} {...customRow("shadowColor")} />
        </> : null}

        <PresetRow label={t("library.fade")} presets={presetOptions(FADE_PRESETS, locale)} value={style.cardOpacity} onChange={(cardOpacity) => set({ cardOpacity })} />
        <ColorRow palette={palette} label={t("murals.fadeColor")} value={style.fadeColor} defaults={[{ label: t("murals.transparent"), value: null }]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={SWATCHES} onChange={(fadeColor) => set({ fadeColor })} {...customRow("fadeColor")} />
        <Caption>{t("murals.fadeNote")}</Caption>
      </Group>
      <Group {...group("looks", t("library.sectionLooks"))}>
        <Caption>{t("tierlists.color")}</Caption>
        {looks(COLOR_LOOKS)}
        <Caption>{t("library.sectionFrame")}</Caption>
        {looks(FRAME_LOOKS)}
        <Caption>{t("murals.savedLooks")}</Caption>
        <SavedLooks style={style} onApply={(next) => { setEditing(null); onChange(next); }} />
        <View style={styles.footer}>
          <Button label={t("murals.reset")} variant="secondary" onPress={onReset} />
          <Button label={t("murals.copyStyle")} variant="secondary" onPress={onCopy} />
          <Button label={t("murals.pasteStyle")} variant="secondary" disabled={!canPaste} onPress={onPaste} />
        </View>
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.sm },
  group: { gap: spacing.sm },
  rowLabel: { fontWeight: "600" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  corner: { width: 36, height: 26, borderTopWidth: 2, borderLeftWidth: 2 },
  sides: { width: 32, height: 22, borderWidth: 2 },
  colorRow: { gap: spacing.sm },
  swatch: { width: minimumTouchTarget, height: minimumTouchTarget, borderRadius: radii.full },
  custom: { alignItems: "center", justifyContent: "center" },
  looks: { gap: spacing.sm },
  lookWrap: { width: 88, alignItems: "center", gap: spacing.xs },
  look: { width: 64, height: 44, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
