import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { DISPLAY_FONT_IDS, TEXT_FONT_IDS, fontLabel, resolveFonts, type FontId, type FontPreference, type FontSlot } from "@scripta/shared/themes";
import { fontStyleFor } from "../../ui/fontStyle";
import { SYSTEM_FAMILY } from "../../ui/systemFont";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { isAppearanceSyncFailure, saveAccountAppearance } from "./appearanceSync";
import { SWATCH } from "./ThemePicker";
import { useLocale, useT } from "../../i18n";

function sampleStyle(font: FontId, slot: FontSlot) {
  return fontStyleFor(font, slot, typography.title) ?? { fontFamily: SYSTEM_FAMILY };
}

export function FontPicker({ slot }: { slot: FontSlot }) {
  const locale = useLocale();
  const t = useT();
  const { id, colors, displayFont, textFont, setFontPreference } = useTheme();
  const selected = slot === "display" ? displayFont : textFont;
  const themeDefault = resolveFonts(id, "theme", "theme")[slot];
  const [error, setError] = useState<string | null>(null);
  const options: FontPreference[] = ["theme", ...(slot === "display" ? DISPLAY_FONT_IDS : TEXT_FONT_IDS)];

  function choose(next: FontPreference) {
    setFontPreference(slot, next);
    setError(null);
    saveAccountAppearance(slot === "display" ? { displayFont: next } : { textFont: next }).catch((err: unknown) => {
      if (!isAppearanceSyncFailure(err)) throw err;
      setError(t("settings.languageSaveFailed"));
    });
  }

  return (
    <View style={styles.wrap}>
      <Text {...dynamicType} style={[typography.caption, styles.heading, { color: colors.textDim }]}>
        {slot === "display" ? t("settings.headings") : t("settings.text")}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={slot === "display" ? t("settings.headingFont") : t("settings.textFont")} style={styles.grid}>
        {options.map((option) => {
          const checked = option === selected;
          const shown = option === "theme" ? themeDefault : option;
          const label = option === "theme" ? t("settings.fontDefault") : fontLabel(option, locale);
          const a11yLabel = option === "theme" ? t("settings.fontThemeDefault", { font: fontLabel(themeDefault, locale) }) : label;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={a11yLabel}
              onPress={() => choose(option)}
              style={styles.item}
            >
              <View style={[styles.tile, { borderColor: checked ? colors.accent : colors.border, borderWidth: checked ? 2 : 1, backgroundColor: checked ? colors.accentSoft : colors.surface }]}>
                <Text {...dynamicType} style={[typography.title, { color: colors.text }, sampleStyle(shown, slot)]}>Aa</Text>
              </View>
              <Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.name, { color: checked ? colors.text : colors.textDim }]}>{label}</Text>
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
  wrap: { gap: spacing.sm },
  heading: { fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm },
  item: { width: "25%", minHeight: minimumTouchTarget, alignItems: "center", gap: spacing.xs },
  tile: { width: SWATCH, height: SWATCH, borderRadius: radii.lg, alignItems: "center", justifyContent: "center" },
  name: { textAlign: "center" },
});
