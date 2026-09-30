import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { THEME_IDS, type ThemePreference } from "@scripta/shared/themes";
import { ThemeGrid } from "../../ui/ThemeGrid";
import { dynamicType, spacing, typography, useTheme } from "../../ui/theme";
import { isAppearanceSyncFailure, saveAccountAppearance } from "./appearanceSync";

const OPTIONS: ThemePreference[] = ["system", ...THEME_IDS];

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
      <ThemeGrid options={OPTIONS} value={preference} onChange={choose} />
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
});
