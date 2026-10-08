import { useState, type ReactNode } from "react";
import { normalizeHexColor } from "@scripta/shared";
import { ColorEditor } from "../../murals/ColorEditor";
import { matchPreset, type Preset } from "../../murals/blockStyleOptions";
import { Icon } from "../../../ui";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { Text } from "../../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typography.caption, styles.sectionTitle, { color: colors.textDim }]}>{title}</Text>
      {children}
    </View>
  );
}

export function Caption({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.caption, { color: colors.textDim }]}>{children}</Text>;
}

export function Chip({ label, selected, onPress, fontFamily }: { label: string; selected: boolean; onPress: () => void; fontFamily?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}>
      <Text numberOfLines={1} style={{ color: selected ? colors.accent : colors.text, fontSize: 14, fontWeight: selected ? "700" : "500", fontFamily }}>{label}</Text>
    </Pressable>
  );
}

export function Tile({ label, selected, onPress, width = 64, tileWidth = 64, height = 48, children }: { label: string; selected: boolean; onPress: () => void; width?: number; tileWidth?: number; height?: number; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.tileWrap, { width }]}>
      <View style={[styles.tile, { width: tileWidth, height, borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 2 : 1, backgroundColor: selected ? colors.accentSoft : colors.surface }]}>{children}</View>
      <Text style={[typography.caption, { color: colors.textDim, alignSelf: "stretch", textAlign: "center" }]}>{label}</Text>
    </Pressable>
  );
}

export function PresetRow({ label, presets, value, onChange }: { label: string; presets: readonly Preset<number>[]; value: number; onChange: (value: number) => void }) {
  const selected = matchPreset(presets, value);
  return <View style={styles.row}><SelectRow label={label} value={selected} options={presets.map((preset) => ({ value: preset.key, label: preset.label }))} onChange={(key) => onChange(presets.find((preset) => preset.key === key)!.value)} />{selected === null ? <Caption>{`Custom · ${value}`}</Caption> : null}</View>;
}

export function StepperRow({
  label,
  value,
  unit = "px",
  range,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}) {
  const { colors } = useTheme();
  const clamp = (v: number) => Math.min(range.max, Math.max(range.min, v));
  return (
    <View style={styles.row}>
      <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityLabel={`Decrease ${label}`}
          accessibilityRole="button"
          disabled={value <= range.min}
          onPress={() => onChange(clamp(value - range.step))}
          style={[styles.stepButton, { borderColor: colors.border, opacity: value <= range.min ? 0.4 : 1 }]}
        >
          <Text style={{ color: colors.text, fontWeight: "700" }}>−</Text>
        </Pressable>
        <Text style={[typography.body, styles.stepValue, { color: colors.textDim }]}>
          {value}
          {unit}
        </Text>
        <Pressable
          accessibilityLabel={`Increase ${label}`}
          accessibilityRole="button"
          disabled={value >= range.max}
          onPress={() => onChange(clamp(value + range.step))}
          style={[styles.stepButton, { borderColor: colors.border, opacity: value >= range.max ? 0.4 : 1 }]}
        >
          <Text style={{ color: colors.text, fontWeight: "700" }}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.toggleLabel}>
        <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{label}</Text>
        {hint && <Text style={[typography.caption, { color: colors.textDim, marginTop: 2 }]}>{hint}</Text>}
      </View>
      <Switch accessibilityLabel={label} onValueChange={onChange} trackColor={{ true: colors.accent }} value={checked} />
    </View>
  );
}

export function SelectRow<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | null;
  options: Array<{ value: V; label: string }>;
  onChange: (value: V) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.selectBlock}>
      <Text style={[typography.body, { color: colors.text, fontWeight: "600", marginBottom: spacing.xs }]}>{label}</Text>
      <View style={styles.selectOptions}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              accessibilityLabel={opt.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[
                styles.selectOption,
                { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : colors.surface },
              ]}
            >
              <Text style={{ color: active ? colors.accent : colors.text, fontSize: 13, fontWeight: active ? "700" : "500" }}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const SWATCHES = ["#ffffff", "#141210", "#a85c32", "#47713c", "#3b5b8c", "#8c3b5b", "#b3432f", "#e0c060"];

export function ColorSwatchRow({ label, value, defaultColor, onChange }: {
  label: string;
  value: string | null;
  defaultColor: string;
  onChange: (color: string | null) => void;
}) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const custom = value !== null && !SWATCHES.includes(value.toLowerCase());
  return (
    <View style={styles.row}>
      <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.swatchRow}>
        <Chip label="Auto" selected={value === null} onPress={() => { setEditing(null); onChange(null); }} />
        {SWATCHES.map((swatch) => (
          <Pressable
            key={swatch}
            accessibilityLabel={`Use ${swatch} for ${label.toLowerCase()}`}
            accessibilityRole="button"
            accessibilityState={{ selected: value?.toLowerCase() === swatch }}
            onPress={() => { setEditing(null); onChange(swatch); }}
            style={[styles.swatch, { backgroundColor: swatch, borderColor: value?.toLowerCase() === swatch ? colors.accent : colors.border, borderWidth: value?.toLowerCase() === swatch ? 3 : 1 }]}
          />
        ))}
        <Pressable
          accessibilityLabel={`Custom ${label.toLowerCase()}${custom ? `, ${value}` : ""}`}
          accessibilityRole="button"
          accessibilityState={{ selected: custom }}
          onPress={() => { if (editing === null) setEditing(normalizeHexColor(value ?? defaultColor) ?? defaultColor); }}
          style={[styles.swatch, styles.custom, { backgroundColor: custom ? value! : colors.surface, borderColor: custom ? colors.accent : colors.border, borderWidth: custom ? 3 : 1 }]}
        >
          {custom ? null : <Icon name="add" size={20} color={colors.text} />}
        </Pressable>
      </View>
      {editing !== null ? <ColorEditor color={editing} onChange={setEditing} onDone={() => { onChange(editing); setEditing(null); }} onCancel={() => setEditing(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.caption, fontWeight: "700", letterSpacing: 0.4 },
  chip: { minHeight: minimumTouchTarget, justifyContent: "center", borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md },
  tileWrap: { alignItems: "center", gap: spacing.xs },
  tile: { borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  custom: { alignItems: "center", justifyContent: "center" },
  row: { gap: spacing.sm },
  rowLabel: { fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepButton: {
    minWidth: minimumTouchTarget,
    minHeight: minimumTouchTarget,
    borderWidth: 1,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { minWidth: 56, textAlign: "center" },
  toggleLabel: { flex: 1, paddingRight: spacing.md },
  selectBlock: { gap: spacing.xs },
  selectOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  selectOption: { minHeight: minimumTouchTarget, justifyContent: "center", borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  swatch: { width: minimumTouchTarget, height: minimumTouchTarget, borderRadius: radii.full },
});
