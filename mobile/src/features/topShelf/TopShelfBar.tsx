import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Icon, Menu, Segmented, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import type { TopShelfPeriod } from "@scripta/shared";
import { useLocale, useT } from "../../i18n";
import { genreMenu, genreName } from "./topShelfModel";

export function TopShelfBar({
  period,
  onPeriod,
  genre,
  onGenre,
  genres,
  genreDisabled,
}: {
  period: TopShelfPeriod;
  onPeriod: (period: TopShelfPeriod) => void;
  genre: string | null;
  onGenre: (genre: string | null) => void;
  genres: string[];
  genreDisabled: boolean;
}) {
  const { colors } = useTheme();
  const t = useT();
  const locale = useLocale();
  const periods = [
    { value: "month", label: t("sharing.periodMonth") },
    { value: "all", label: t("sharing.periodAll") },
  ] as const;
  const label = genre ? genreName(genre, locale) : t("sharing.allGenres");
  const active = genre !== null && !genreDisabled;
  const pill = (
    <View style={[styles.pill, { borderColor: colors.border, backgroundColor: active ? colors.accentSoft : colors.surface, opacity: genreDisabled ? 0.5 : 1 }]}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.pillLabel, { color: active ? colors.text : colors.textDim }]}>{label}</Text>
      <View style={styles.chevron}><Icon name="chevronRight" size={16} color={active ? colors.text : colors.textDim} /></View>
    </View>
  );
  const items = [
    { label: t("sharing.allGenres"), selected: genre === null, onPress: () => onGenre(null) },
    ...genreMenu(genres, genre).map((name) => ({ label: genreName(name, locale), selected: name === genre, onPress: () => onGenre(name) })),
  ];

  return (
    <View style={styles.row}>
      <View style={styles.segmented}>
        <Segmented options={periods} value={period} onChange={onPeriod} accessibilityLabel={t("sharing.period")} />
      </View>
      <View style={styles.genre}>
        {genreDisabled ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("sharing.genre")} accessibilityState={{ disabled: true }} disabled>{pill}</Pressable>
        ) : (
          <Menu key={label.length} title={t("sharing.genre")} items={items}>{pill}</Menu>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: { flexGrow: 1, flexShrink: 0, minWidth: 200 },
  genre: { flexShrink: 0 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: 140, height: minimumTouchTarget, paddingHorizontal: spacing.sm, borderWidth: 1, borderRadius: radii.full },
  chevron: { transform: [{ rotate: "90deg" }] },
  pillLabel: { flexShrink: 1 },
});
