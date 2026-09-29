import { BLOCK_FONT_FAMILY_OPTIONS, BLOCK_INNER_SPACING_OPTIONS, BLOCK_TEXT_ALIGN_OPTIONS, BLOCK_THEME_COLOR_LABELS, resolveBlockColor, themeColorRef, type BlockStyle, type BlockThemeColorKey } from "@scripta/shared";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../ui";
import { Text } from "../../ui/Text";
import { blockFontFamily } from "../../ui/libraryStyle";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { SelectRow, SWATCHES } from "../library/components/StyleControls";
import {
  BACKGROUND_FIXED_SWATCHES, BACKGROUND_THEME_SWATCHES, BORDER_SIDE_PRESETS, BORDER_STRENGTH_PRESETS, BORDER_STYLE_CHOICES, BORDER_THEME_SWATCHES,
  BORDER_WIDTH_PRESETS, CORNER_PRESETS, FADE_PRESETS, QUICK_LOOKS, SIZE_PRESETS, TEXT_THEME_SWATCHES,
  applyLook, isHardToRead, matchPreset, matchSides, type Preset, type QuickLook,
} from "./blockStyleOptions";

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[typography.caption, styles.groupTitle, { color: colors.textDim }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Caption({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.caption, { color: colors.textDim }]}>{children}</Text>;
}

function Chip({ label, selected, onPress, fontFamily }: { label: string; selected: boolean; onPress: () => void; fontFamily?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}>
      <Text style={{ color: selected ? colors.accent : colors.text, fontSize: 14, fontWeight: selected ? "700" : "500", fontFamily }}>{label}</Text>
    </Pressable>
  );
}

function Tile({ label, selected, onPress, children }: { label: string; selected: boolean; onPress: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.tileWrap}>
      <View style={[styles.tile, { borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 2 : 1, backgroundColor: selected ? colors.accentSoft : colors.surface }]}>{children}</View>
      <Text style={[typography.caption, { color: colors.textDim }]}>{label}</Text>
    </Pressable>
  );
}

function PresetRow({ label, presets, value, onChange }: { label: string; presets: readonly Preset<number>[]; value: number; onChange: (value: number) => void }) {
  return <SelectRow label={label} value={matchPreset(presets, value)} options={presets.map((preset) => ({ value: preset.key, label: preset.label }))} onChange={(key) => onChange(presets.find((preset) => preset.key === key)!.value)} />;
}

function ColorRow({ label, value, defaults, themeKeys, fixed, onChange }: {
  label: string;
  value: string | null;
  defaults: Array<{ label: string; value: string | null }>;
  themeKeys: readonly BlockThemeColorKey[];
  fixed: readonly string[];
  onChange: (value: string | null) => void;
}) {
  const { colors } = useTheme();
  const current = value?.toLowerCase() ?? null;
  const swatch = (key: string, accessibilityLabel: string, fill: string, stored: string) => {
    const selected = current === stored.toLowerCase();
    return <Pressable key={key} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected }} onPress={() => onChange(stored)} style={[styles.swatch, { backgroundColor: fill, borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 3 : 1 }]} />;
  };
  return (
    <View style={styles.colorRow}>
      <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.wrap}>{defaults.map((option) => <Chip key={option.label} label={option.label} selected={value === option.value} onPress={() => onChange(option.value)} />)}</View>
      <Caption>Theme · changes with the theme</Caption>
      <View style={styles.wrap}>{themeKeys.map((key) => swatch(key, `${BLOCK_THEME_COLOR_LABELS[key]}, theme color`, colors[key], themeColorRef(key)))}</View>
      <Caption>Fixed</Caption>
      <View style={styles.wrap}>{fixed.map((hex) => swatch(hex, `Use ${hex}`, hex, hex))}</View>
    </View>
  );
}

function LookCard({ look, onPress }: { look: QuickLook; onPress: () => void }) {
  const { colors } = useTheme();
  const { style } = look;
  const background = resolveBlockColor(style.backgroundColor, colors) ?? colors.surface;
  const text = resolveBlockColor(style.textColor, colors) ?? colors.text;
  const border = resolveBlockColor(style.cardBorderColor, colors) ?? colors.border;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Apply the ${look.label} look`} onPress={onPress} style={styles.lookWrap}>
      <View style={[styles.look, { backgroundColor: background, borderColor: style.cardBorderWidth ? border : colors.border, borderWidth: Math.max(1, style.cardBorderWidth), borderStyle: style.cardBorderWidth ? "solid" : "dashed", borderRadius: Math.min(style.cardRadius, radii.lg) }]}>
        <Text style={{ color: text, fontFamily: blockFontFamily(style.fontFamily), fontWeight: style.bold ? "700" : "400", fontSize: 16 }}>Aa</Text>
      </View>
      <Text style={[typography.caption, { color: colors.textDim }]}>{look.label}</Text>
    </Pressable>
  );
}

export function StyleTab({ style, onChange, onReset, onCopy, onPaste, canPaste }: {
  style: BlockStyle;
  onChange: (style: BlockStyle) => void;
  onReset: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
}) {
  const { colors } = useTheme();
  const set = (patch: Partial<BlockStyle>) => onChange({ ...style, ...patch });
  const looks = (group: QuickLook["group"]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.looks}>
      {QUICK_LOOKS.filter((look) => look.group === group).map((look) => <LookCard key={look.key} look={look} onPress={() => onChange(applyLook(style, look))} />)}
    </ScrollView>
  );
  return (
    <View style={styles.tab}>
      <Group title="Quick looks">
        <Caption>Theme looks change with the theme</Caption>
        {looks("theme")}
        <Caption>Fixed looks</Caption>
        {looks("fixed")}
      </Group>
      <ColorRow label="Background" value={style.backgroundColor} defaults={[{ label: "None", value: "transparent" }, { label: "Theme", value: null }]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={BACKGROUND_FIXED_SWATCHES} onChange={(backgroundColor) => set(backgroundColor === "transparent" ? { backgroundColor, cardShadow: false } : { backgroundColor })} />
      <Group title="Corners">
        <View style={styles.wrap}>
          {CORNER_PRESETS.map((preset) => (
            <Tile key={preset.key} label={preset.label} selected={style.cardRadius === preset.value} onPress={() => set({ cardRadius: preset.value })}>
              <View style={[styles.corner, { borderColor: colors.text, borderTopLeftRadius: preset.value }]} />
            </Tile>
          ))}
        </View>
      </Group>
      <Group title="Text">
        <View style={styles.wrap}>
          {BLOCK_FONT_FAMILY_OPTIONS.map((option) => <Chip key={option.value} label={option.label.replace(" (system)", "")} fontFamily={blockFontFamily(option.value)} selected={style.fontFamily === option.value} onPress={() => set({ fontFamily: option.value })} />)}
        </View>
        <PresetRow label="Size" presets={SIZE_PRESETS} value={style.fontSize} onChange={(fontSize) => set({ fontSize })} />
        <View style={styles.wrap}>
          <Chip label="Bold" selected={style.bold} onPress={() => set({ bold: !style.bold })} />
          <Chip label="Italic" selected={style.italic} onPress={() => set({ italic: !style.italic })} />
          <Chip label="Code" selected={style.codeStyle} onPress={() => set({ codeStyle: !style.codeStyle })} />
        </View>
        <SelectRow label="Alignment" value={style.textAlign} options={BLOCK_TEXT_ALIGN_OPTIONS} onChange={(textAlign) => set({ textAlign })} />
        <ColorRow label="Text color" value={style.textColor} defaults={[{ label: "Auto", value: null }]} themeKeys={TEXT_THEME_SWATCHES} fixed={SWATCHES} onChange={(textColor) => set({ textColor })} />
        {isHardToRead(style, colors) ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>Hard to read on this background</Text> : null}
      </Group>
      <Group title="Border">
        <PresetRow label="Width" presets={BORDER_WIDTH_PRESETS} value={style.cardBorderWidth} onChange={(cardBorderWidth) => set({ cardBorderWidth })} />
        {style.cardBorderWidth > 0 ? <>
          <SelectRow label="Style" value={BORDER_STYLE_CHOICES.some((choice) => choice.value === style.cardBorderStyle) ? style.cardBorderStyle : null} options={BORDER_STYLE_CHOICES} onChange={(cardBorderStyle) => set({ cardBorderStyle })} />
          <PresetRow label="Strength" presets={BORDER_STRENGTH_PRESETS} value={style.cardBorderOpacity} onChange={(cardBorderOpacity) => set({ cardBorderOpacity })} />
          <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>Sides</Text>
          <View style={styles.wrap}>
            {BORDER_SIDE_PRESETS.map((preset) => {
              const edge = (on: boolean) => (on ? colors.text : colors.border);
              return (
                <Tile key={preset.key} label={preset.label} selected={matchSides(style.cardBorderSides) === preset.key} onPress={() => set({ cardBorderSides: preset.value })}>
                  <View style={[styles.sides, { borderTopColor: edge(preset.value.top), borderRightColor: edge(preset.value.right), borderBottomColor: edge(preset.value.bottom), borderLeftColor: edge(preset.value.left) }]} />
                </Tile>
              );
            })}
          </View>
          <ColorRow label="Border color" value={style.cardBorderColor} defaults={[{ label: "Auto", value: null }]} themeKeys={BORDER_THEME_SWATCHES} fixed={SWATCHES} onChange={(cardBorderColor) => set({ cardBorderColor })} />
        </> : null}
      </Group>
      <SelectRow label="Shadow" value={style.cardShadow ? "soft" : "none"} options={[{ value: "none", label: "None" }, { value: "soft", label: "Soft" }]} onChange={(value) => set({ cardShadow: value === "soft" })} />
      <PresetRow label="Fade" presets={FADE_PRESETS} value={style.cardOpacity} onChange={(cardOpacity) => set({ cardOpacity })} />
      <SelectRow label="Inner spacing" value={style.innerSpacing} options={BLOCK_INNER_SPACING_OPTIONS} onChange={(innerSpacing) => set({ innerSpacing })} />
      <View style={styles.footer}>
        <Button label="Reset" variant="secondary" onPress={onReset} />
        <Button label="Copy style" variant="secondary" onPress={onCopy} />
        <Button label="Paste style" variant="secondary" disabled={!canPaste} onPress={onPaste} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.xl },
  group: { gap: spacing.sm },
  groupTitle: { fontWeight: "700", letterSpacing: 0.4 },
  rowLabel: { fontWeight: "600" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: minimumTouchTarget, justifyContent: "center", borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md },
  tileWrap: { alignItems: "center", gap: spacing.xs },
  tile: { width: 64, height: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  corner: { width: 36, height: 26, borderTopWidth: 2, borderLeftWidth: 2 },
  sides: { width: 32, height: 22, borderWidth: 2 },
  colorRow: { gap: spacing.sm },
  swatch: { width: minimumTouchTarget, height: minimumTouchTarget, borderRadius: radii.full },
  looks: { gap: spacing.sm },
  lookWrap: { alignItems: "center", gap: spacing.xs },
  look: { width: 64, height: 44, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
