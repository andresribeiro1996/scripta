import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { DISPLAY_FONT_IDS, TEXT_FONT_IDS, fonts, resolveFonts, type FontId, type FontPreference, type FontSlot } from "@scripta/shared/themes";
import { fontStyleFor } from "../../ui/fontStyle";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { isAppearanceSyncFailure, saveAccountAppearance } from "./appearanceSync";

const SYSTEM_FAMILY = Platform.select({ ios: "System", default: "sans-serif" });

function sampleStyle(font: FontId, slot: FontSlot) {
  return fontStyleFor(font, slot, typography.body) ?? { fontFamily: SYSTEM_FAMILY };
}

export function FontPicker({ slot }: { slot: FontSlot }) {
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
      setError("Couldn't save to your account. Try again.");
    });
  }

  return (
    <View style={styles.wrap}>
      <Text {...dynamicType} style={[typography.caption, styles.heading, { color: colors.textDim }]}>
        {slot === "display" ? "Headings" : "Text"}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={slot === "display" ? "Heading font" : "Text font"} style={styles.row}>
        {options.map((option) => {
          const checked = option === selected;
          const shown = option === "theme" ? themeDefault : option;
          const label = option === "theme" ? `Theme default · ${fonts[themeDefault].label}` : fonts[option].label;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={label}
              onPress={() => choose(option)}
              style={[styles.chip, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}
            >
              <Text {...dynamicType} style={[typography.body, { color: colors.text }, sampleStyle(shown, slot)]}>
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
  wrap: { gap: spacing.sm },
  heading: { fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: minimumTouchTarget, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1 },
});
