import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { THEME_IDS, type ThemePreference } from "@scripta/shared/themes";
import { themeTile } from "../../ui/ThemeGrid";
import { Icon } from "../../ui/icon";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { isAppearanceSyncFailure, saveAccountAppearance } from "./appearanceSync";

const OPTIONS: ThemePreference[] = ["system", ...THEME_IDS];

const SWATCH = 46;

export function ThemePicker() {
  const { colors, preference, setPreference } = useTheme();
  const [error, setError] = useState<string | null>(null);

  function choose(next: ThemePreference) {
    setPreference(next, { fade: true });
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
          const { label, palettes } = themeTile(option);
          const left = palettes[0];
          const right = palettes[palettes.length - 1];
          return (
            <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={label} onPress={() => choose(option)} style={styles.item}>
              <View style={[styles.circle, { borderColor: checked ? colors.accent : colors.border }]}>
                <View style={[styles.half, { left: 0, backgroundColor: left.background }]} />
                <View style={[styles.half, { right: 0, backgroundColor: right.background }]} />
                <View style={[styles.dot, { backgroundColor: right.accent, borderColor: right.background }]} />
                {checked ? <Icon name="confirm" size={18} color={colors.accent} /> : null}
              </View>
              <Text {...dynamicType} numberOfLines={1} style={[typography.caption, { color: checked ? colors.text : colors.textDim }]}>{label}</Text>
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
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm },
  item: { width: "25%", minHeight: minimumTouchTarget, alignItems: "center", gap: spacing.xs },
  circle: { width: SWATCH, height: SWATCH, borderRadius: radii.full, borderWidth: 2, flexDirection: "row", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  half: { position: "absolute", top: 0, bottom: 0, width: "50%" },
  dot: { position: "absolute", right: 4, bottom: 4, width: 12, height: 12, borderRadius: radii.full, borderWidth: 1 },
});
