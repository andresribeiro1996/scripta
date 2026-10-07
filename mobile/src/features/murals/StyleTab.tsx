import { BLOCK_BACKGROUND_FINISH_OPTIONS, BLOCK_FONT_FAMILY_OPTIONS, BLOCK_INNER_SPACING_OPTIONS, BLOCK_TEXT_ALIGN_OPTIONS, BLOCK_THEME_COLOR_LABELS, normalizeHexColor, resolveBlockColor, themeColorRef, type BlockStyle, type BlockThemeColorKey } from "@scripta/shared";
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
  BACKGROUND_FIXED_SWATCHES, BACKGROUND_THEME_SWATCHES, BORDER_SIDE_PRESETS, BORDER_STRENGTH_PRESETS, BORDER_STYLE_CHOICES, BORDER_THEME_SWATCHES,
  BORDER_WIDTH_PRESETS, COLOR_LOOKS, CORNER_PRESETS, FADE_PRESETS, FRAME_LOOKS, GRADIENT_DIRECTION_PRESETS, GRADIENT_STRENGTH_PRESETS, SHADOW_BLUR_PRESETS, SHADOW_DISTANCE_PRESETS, SHADOW_STRENGTH_PRESETS, SIZE_PRESETS, TEXT_THEME_SWATCHES,
  applyLook, customColorStart, isHardToRead, matchSides, type CustomColorTarget, type Look,
} from "./blockStyleOptions";

const COLLAPSIBLE_CONTENT_INSET = 32;

function Group({ title, open, onOpenChange, width, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; width?: number; children: ReactNode }) {
  const { colors, mode } = useTheme();
  return (
    <Host matchContents={{ vertical: true }} colorScheme={mode} seedColor={colors.accent}>
      <Collapsible label={title} labelStyle={{ color: colors.text, fontSize: 16, fontWeight: "600" }} isOpen={open} onOpenChange={onOpenChange}>
        <RNHostView matchContents><View style={[styles.group, { width }]}>{Platform.OS === "android" && width === undefined ? null : children}</View></RNHostView>
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
      <Caption>Theme · follows the mural theme</Caption>
      <View style={styles.wrap}>{themeKeys.map((key) => swatch(key, `${BLOCK_THEME_COLOR_LABELS[key]}, theme color`, palette[key], themeColorRef(key)))}</View>
      <Caption>Fixed</Caption>
      <View style={styles.wrap}>{fixed.map((hex) => swatch(hex, `Use ${hex}`, hex, hex))}
        <Pressable accessibilityRole="button" accessibilityLabel={custom ? `Custom color, ${custom}` : "Custom color"} accessibilityState={{ selected: custom !== null }} onPress={onCustom} style={[styles.swatch, styles.custom, { backgroundColor: custom ?? colors.surface, borderColor: custom ? colors.accent : colors.border, borderWidth: custom ? 3 : 1 }]}>
          {custom ? null : <Icon name="add" size={20} color={colors.text} />}
        </Pressable>
      </View>
      {editor}
    </View>
  );
}

function LookCard({ look, style, palette, onPress }: { look: Look; style: BlockStyle; palette: ThemeColors; onPress: () => void }) {
  const { colors } = useTheme();
  const preview = applyLook(style, look);
  const background = resolveBlockColor(preview.backgroundColor, palette) ?? palette.surface;
  const text = resolveBlockColor(preview.textColor, palette) ?? palette.text;
  const border = resolveBlockColor(preview.cardBorderColor, palette) ?? palette.border;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Apply the ${look.label} look`} onPress={onPress} style={styles.lookWrap}>
      <View style={[styles.look, { backgroundColor: background, borderColor: preview.cardBorderWidth ? border : palette.border, borderWidth: Math.max(1, preview.cardBorderWidth), borderStyle: preview.cardBorderWidth ? "solid" : "dashed", borderRadius: Math.min(preview.cardRadius, radii.lg) }]}>
        <Text style={{ color: text, fontFamily: blockFontFamily(preview.fontFamily), fontWeight: preview.bold ? "700" : "400", fontSize: 16 }}>Aa</Text>
      </View>
      <Text style={[typography.caption, { color: colors.textDim }]}>{look.label}</Text>
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
  const { colors } = useTheme();
  const set = (patch: Partial<BlockStyle>) => onChange({ ...style, ...patch });
  const [section, setSection] = useState<string | null>("Background");
  const [tabWidth, setTabWidth] = useState(0);
  const groupWidth = Platform.OS === "android" && tabWidth > 0 ? tabWidth - COLLAPSIBLE_CONTENT_INSET : undefined;
  const [editing, setEditing] = useState<{ target: CustomColorTarget; previous: string | null } | null>(null);
  const latest = useRef({ style, onChange, editing });
  latest.current = { style, onChange, editing };
  useEffect(() => () => {
    const { style: current, onChange: change, editing: open } = latest.current;
    if (open) change({ ...current, [open.target]: open.previous });
  }, []);
  const group = (title: string) => ({
    title,
    width: groupWidth,
    open: section === title,
    onOpenChange: (open: boolean) => {
      if (editing) { set({ [editing.target]: editing.previous }); setEditing(null); }
      setSection(open ? title : null);
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
      <Group {...group("Background")}>
        <ColorRow palette={palette} label="Background" value={style.backgroundColor} defaults={[{ label: "None", value: "transparent" }, { label: "Theme", value: null }]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={BACKGROUND_FIXED_SWATCHES} onChange={(backgroundColor) => set(backgroundColor === "transparent" ? { backgroundColor, cardShadow: false } : { backgroundColor })} {...customRow("backgroundColor")} />
        <SelectRow label="Gradient" value={style.gradientColor ? "on" : "none"} options={[{ value: "none", label: "None" }, { value: "on", label: "On" }]} onChange={(value) => set({ gradientColor: value === "on" ? themeColorRef("accent") : null, ...(value === "on" && style.backgroundColor === "transparent" ? { backgroundColor: null } : {}) })} />
        {style.gradientColor ? <>
          <Caption>The background is the first color.</Caption>
          <ColorRow palette={palette} label="Second color" value={style.gradientColor} defaults={[]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={BACKGROUND_FIXED_SWATCHES} onChange={(gradientColor) => set({ gradientColor })} {...customRow("gradientColor")} />
          <PresetRow label="Direction" presets={GRADIENT_DIRECTION_PRESETS} value={style.gradientAngle} onChange={(gradientAngle) => set({ gradientAngle })} />
          <PresetRow label="Blend strength" presets={GRADIENT_STRENGTH_PRESETS} value={style.gradientStrength} onChange={(gradientStrength) => set({ gradientStrength })} />
        </> : null}
        <SelectRow label="Finish" value={style.backgroundFinish} options={BLOCK_BACKGROUND_FINISH_OPTIONS} onChange={(backgroundFinish) => set({ backgroundFinish })} />
        {style.backgroundColor === "transparent" ? <Caption>Shows when the block has a background</Caption> : null}
        <SelectRow label="Inner spacing" value={style.innerSpacing} options={BLOCK_INNER_SPACING_OPTIONS} onChange={(innerSpacing) => set({ innerSpacing })} />
      </Group>
      <Group {...group("Text")}>
        <ColorRow palette={palette} label="Text color" value={style.textColor} defaults={[{ label: "Auto", value: null }]} themeKeys={TEXT_THEME_SWATCHES} fixed={SWATCHES} onChange={(textColor) => set({ textColor })} {...customRow("textColor")} />
        {isHardToRead(style, palette) ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>Hard to read on this background</Text> : null}

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
      </Group>
      <Group {...group("Border")}>
        <View style={styles.wrap}>
          {CORNER_PRESETS.map(({ key, label, value: radius }) => (
            <Tile key={key} label={label} selected={style.cardRadius === radius} onPress={() => set({ cardRadius: radius })}>
              <View style={[styles.corner, { borderColor: colors.text, borderTopLeftRadius: radius }]} />
            </Tile>
          ))}
        </View>
        <PresetRow label="Width" presets={BORDER_WIDTH_PRESETS} value={style.cardBorderWidth} onChange={(cardBorderWidth) => set({ cardBorderWidth })} />
        {style.cardBorderWidth > 0 ? <>
          <SelectRow label="Style" value={resolveBorderStyle(style.cardBorderStyle)} options={BORDER_STYLE_CHOICES} onChange={(cardBorderStyle) => set({ cardBorderStyle })} />
          {resolveBorderStyle(style.cardBorderStyle) !== style.cardBorderStyle ? <Caption>{`${style.cardBorderStyle[0].toUpperCase() + style.cardBorderStyle.slice(1)} is saved for web; displays as ${resolveBorderStyle(style.cardBorderStyle)} here.`}</Caption> : null}
          <PresetRow label="Strength" presets={BORDER_STRENGTH_PRESETS} value={style.cardBorderOpacity} onChange={(cardBorderOpacity) => set({ cardBorderOpacity })} />
          <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>Sides</Text>
          <View style={styles.wrap}>
            {BORDER_SIDE_PRESETS.map(({ key, label, value: sides }) => {
              const edge = (on: boolean) => (on ? colors.text : colors.border);
              return (
                <Tile key={key} label={label} selected={matchSides(style.cardBorderSides) === key} onPress={() => set({ cardBorderSides: sides })}>
                  <View style={[styles.sides, { borderTopColor: edge(sides.top), borderRightColor: edge(sides.right), borderBottomColor: edge(sides.bottom), borderLeftColor: edge(sides.left) }]} />
                </Tile>
              );
            })}
          </View>
          <ColorRow palette={palette} label="Border color" value={style.cardBorderColor} defaults={[{ label: "Auto", value: null }]} themeKeys={BORDER_THEME_SWATCHES} fixed={SWATCHES} onChange={(cardBorderColor) => set({ cardBorderColor })} {...customRow("cardBorderColor")} />
        </> : null}
      </Group>
      <Group {...group("Effects")}>
        <SelectRow label="Shadow" value={style.cardShadow ? "on" : "none"} options={[{ value: "none", label: "None" }, { value: "on", label: "On" }]} onChange={(value) => set({ cardShadow: value === "on" })} />
        {style.cardShadow ? <>
          <PresetRow label="Shadow strength" presets={SHADOW_STRENGTH_PRESETS} value={style.shadowOpacity} onChange={(shadowOpacity) => set({ shadowOpacity })} />
          <PresetRow label="Shadow softness" presets={SHADOW_BLUR_PRESETS} value={style.shadowBlur} onChange={(shadowBlur) => set({ shadowBlur })} />
          <PresetRow label="Shadow distance" presets={SHADOW_DISTANCE_PRESETS} value={style.shadowOffsetY} onChange={(shadowOffsetY) => set({ shadowOffsetY })} />
          <ColorRow palette={palette} label="Shadow color" value={style.shadowColor} defaults={[{ label: "Black", value: null }]} themeKeys={BORDER_THEME_SWATCHES} fixed={SWATCHES} onChange={(shadowColor) => set({ shadowColor })} {...customRow("shadowColor")} />
        </> : null}

        <PresetRow label="Fade" presets={FADE_PRESETS} value={style.cardOpacity} onChange={(cardOpacity) => set({ cardOpacity })} />
        <ColorRow palette={palette} label="Fade color" value={style.fadeColor} defaults={[{ label: "Transparent", value: null }]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={SWATCHES} onChange={(fadeColor) => set({ fadeColor })} {...customRow("fadeColor")} />
        <Caption>Transparent fades into the mural. A color washes over the block at the selected fade level.</Caption>
      </Group>
      <Group {...group("Looks")}>
        <Caption>Color</Caption>
        {looks(COLOR_LOOKS)}
        <Caption>Frame</Caption>
        {looks(FRAME_LOOKS)}
        <Caption>Saved looks</Caption>
        <SavedLooks style={style} onApply={(next) => { setEditing(null); onChange(next); }} />
        <View style={styles.footer}>
          <Button label="Reset" variant="secondary" onPress={onReset} />
          <Button label="Copy style" variant="secondary" onPress={onCopy} />
          <Button label="Paste style" variant="secondary" disabled={!canPaste} onPress={onPaste} />
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
  lookWrap: { alignItems: "center", gap: spacing.xs },
  look: { width: 64, height: 44, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
