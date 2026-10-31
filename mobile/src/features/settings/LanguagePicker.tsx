import { useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LocalePreference } from "@scripta/shared/i18n";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { PORTUGUESE_ENABLED, getLocalePreference, setLocalePreference, subscribeLocale, useT } from "../../i18n";
import { isAppearanceSyncFailure, saveAccountAppearance } from "./appearanceSync";

const OPTIONS: LocalePreference[] = ["auto", "en", "pt-PT"];

export function LanguagePicker() {
  const { colors } = useTheme();
  const selected = useSyncExternalStore(subscribeLocale, getLocalePreference, getLocalePreference);
  const t = useT();
  const [failed, setFailed] = useState(false);

  if (!PORTUGUESE_ENABLED) return null;

  const labels: Record<LocalePreference, string> = { auto: t("settings.languageAuto"), en: "English", "pt-PT": "Português" };

  function choose(next: LocalePreference) {
    setLocalePreference(next);
    setFailed(false);
    saveAccountAppearance({ locale: next }).catch((err: unknown) => {
      if (!isAppearanceSyncFailure(err)) throw err;
      setFailed(true);
    });
  }

  return (
    <View style={styles.wrap}>
      <Text {...dynamicType} style={[typography.caption, styles.heading, { color: colors.textDim }]}>
        {t("settings.language")}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("settings.language")} style={styles.options}>
        {OPTIONS.map((option) => {
          const checked = option === selected;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              onPress={() => choose(option)}
              style={[styles.option, { borderColor: checked ? colors.accent : colors.border, borderWidth: checked ? 2 : 1, backgroundColor: checked ? colors.accentSoft : colors.surface }]}
            >
              <Text {...dynamicType} style={[typography.caption, { color: checked ? colors.text : colors.textDim }]}>{labels[option]}</Text>
            </Pressable>
          );
        })}
      </View>
      {failed ? (
        <Text accessibilityRole="alert" {...dynamicType} style={[typography.caption, { color: colors.danger }]}>
          {t("settings.languageSaveFailed")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  heading: { fontWeight: "600" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: { minHeight: minimumTouchTarget, paddingHorizontal: spacing.md, borderRadius: radii.lg, alignItems: "center", justifyContent: "center" },
});
