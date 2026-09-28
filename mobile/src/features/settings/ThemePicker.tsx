import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { THEME_IDS, themes, type ThemeColors, type ThemePreference } from "@scripta/shared/themes";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { isAppearanceSyncFailure, saveAccountAppearance } from "./appearanceSync";

const OPTIONS: ThemePreference[] = ["system", ...THEME_IDS];

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

export function ThemePicker() {
  const { colors, preference, setPreference } = useTheme();
  const [error, setError] = useState<string | null>(null);

  function choose(next: ThemePreference) {
    setPreference(next);
    setError(null);
    saveAccountAppearance({ theme: next }).catch((err: unknown) => {
      if (!isAppearanceSyncFailure(err)) throw err;
      setError("Couldn't save to your account. Try again.");
    });
  }

  return (
    <View style={styles.wrap}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={styles.grid}>
        {OPTIONS.map((option) => {
          const checked = option === preference;
          const label = option === "system" ? "System" : themes[option].label;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={label}
              onPress={() => choose(option)}
              style={styles.tile}
            >
              <View style={[styles.preview, { borderColor: checked ? colors.accent : colors.border }]}>
                {option === "system" ? (
                  <>
                    <Swatch colors={themes.light.colors} />
                    <Swatch colors={themes.dark.colors} />
                  </>
                ) : (
                  <Swatch colors={themes[option].colors} />
                )}
              </View>
              <Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.label, { color: checked ? colors.text : colors.textDim }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text accessibilityRole="alert" {...dynamicType} style={[typography.caption, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { width: "30%", flexGrow: 1, minHeight: minimumTouchTarget, gap: spacing.xs },
  preview: { height: 64, flexDirection: "row", borderRadius: radii.md, borderWidth: 2, overflow: "hidden" },
  swatch: { flex: 1, padding: spacing.xs },
  card: { flex: 1, borderWidth: 1, borderRadius: radii.sm, padding: spacing.xs, justifyContent: "space-between" },
  line: { height: 4, borderRadius: radii.full },
  bar: { height: 8, borderRadius: radii.sm },
  label: { textAlign: "center" },
});
