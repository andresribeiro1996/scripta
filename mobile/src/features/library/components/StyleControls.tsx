// Native building blocks for the style panels (LibraryStyleView.tsx,
// PerCardStyleForm.tsx) — mirrors frontend's components/StyleControls.tsx
// section-by-section (Section/SliderRow/ToggleRow → Section/StepperRow/
// ToggleRow/SelectRow/ColorSwatchRow here), adapted for touch:
//
//  - SliderRow (an HTML <input type="range">) becomes StepperRow
//    (-/+ buttons on each side of the value) — this app has no drag-
//    slider component installed (@react-native-community/slider isn't a
//    dependency, and adding one is a mobile/package.json change this
//    task doesn't own), and a stepper is fully accessible by default
//    (VoiceOver/TalkBack increment/decrement actions) where a custom
//    drag gesture would need its own a11y wiring.
//  - The web's native `<input type="color">` becomes ColorSwatchRow, a
//    fixed palette rather than a freeform picker — same reasoning
//    (no color-picker dependency in this app yet). See this task's
//    handoff notes.
//
// Every row debounces through the caller's own onApply (see
// lib/debounce.ts) exactly like the web version's onApply/onSaveNow
// split — a stepper tap is discrete already (not a continuous drag), but
// holding one down still fires many times a second, so it gets the same
// coalescing treatment as a slider drag did on the web.

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {title && <Text style={[styles.sectionTitle, { color: colors.textDim }]}>{title.toUpperCase()}</Text>}
      {children}
    </View>
  );
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
      <Switch onValueChange={onChange} trackColor={{ true: colors.accent }} value={checked} />
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
  value: V;
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

const SWATCHES = ["#ffffff", "#1a1815", "#a85c32", "#47713c", "#3b5b8c", "#8c3b5b", "#b3432f", "#e0c060"];

export function ColorSwatchRow({
  label,
  value,
  defaultColor,
  onEnable,
  onChange,
  onDisable,
}: {
  label: string;
  /** null = "use the theme default" (this row's own on/off toggle). */
  value: string | null;
  defaultColor: string;
  onEnable: () => void;
  onChange: (color: string) => void;
  onDisable: () => void;
}) {
  const { colors } = useTheme();
  const enabled = value !== null;
  return (
    <View style={styles.row}>
      <ToggleRow label={label} checked={enabled} onChange={(next) => (next ? onEnable() : onDisable())} />
      {enabled && (
        <View style={styles.swatchRow}>
          {SWATCHES.map((swatch) => (
            <Pressable
              accessibilityLabel={`Use ${swatch}`}
              accessibilityRole="button"
              key={swatch}
              onPress={() => onChange(swatch)}
              style={[
                styles.swatch,
                { backgroundColor: swatch, borderColor: (value ?? defaultColor).toLowerCase() === swatch ? colors.accent : colors.border },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  sectionTitle: { ...typography.caption, fontWeight: "700", letterSpacing: 0.4 },
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
  selectOption: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  swatch: { width: 32, height: 32, borderRadius: radii.full, borderWidth: 2 },
});
