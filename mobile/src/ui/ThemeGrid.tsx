import { Pressable, StyleSheet, View } from "react-native";
import { themes, type ThemeColors, type ThemePreference } from "@scripta/shared/themes";
import { Text } from "./Text";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "./theme";

function Swatch({ colors }: { colors: ThemeColors }) {
  return (
    <View style={[styles.swatch, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.line, { width: "75%", backgroundColor: colors.text }]} />
        <View style={[styles.line, { width: "50%", backgroundColor: colors.textDim }]} />
        <View style={[styles.bar, { backgroundColor: colors.accent }]} />
      </View>
    </View>
  );
}

function tile(option: ThemePreference) {
  return option === "system" ? { label: "System", palettes: [themes.light.colors, themes.dark.colors] } : { label: themes[option].label, palettes: [themes[option].colors] };
}

export function ThemeGrid<T extends ThemePreference>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (option: T) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={styles.grid}>
      {options.map((option) => {
        const checked = option === value;
        const { label, palettes } = tile(option);
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            accessibilityLabel={label}
            onPress={() => onChange(option)}
            style={styles.tile}
          >
            <View style={[styles.preview, { borderColor: checked ? colors.accent : colors.border }]}>
              {palettes.map((palette, index) => <Swatch key={index} colors={palette} />)}
            </View>
            <Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.label, { color: checked ? colors.text : colors.textDim }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { width: "30%", flexGrow: 1, minHeight: minimumTouchTarget, gap: spacing.xs },
  preview: { height: 64, flexDirection: "row", borderRadius: radii.md, borderWidth: 2, overflow: "hidden" },
  swatch: { flex: 1, padding: spacing.xs },
  card: { flex: 1, borderWidth: 1, borderRadius: radii.sm, padding: spacing.xs, justifyContent: "space-between" },
  line: { height: 4, borderRadius: radii.full },
  bar: { height: 8, borderRadius: radii.sm },
  label: { textAlign: "center" },
});
