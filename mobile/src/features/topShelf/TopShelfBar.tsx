import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Icon, Menu, Segmented, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import type { TopShelfPeriod } from "@scripta/shared";
import { genreMenu } from "./topShelfModel";

const PERIODS = [
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
] as const;

const ALL_GENRES = "All genres";

export function TopShelfBar({
  period,
  onPeriod,
  genre,
  onGenre,
  genres,
  genreDisabled,
  onHeight,
}: {
  period: TopShelfPeriod;
  onPeriod: (period: TopShelfPeriod) => void;
  genre: string | null;
  onGenre: (genre: string | null) => void;
  genres: string[];
  genreDisabled: boolean;
  onHeight?: (height: number) => void;
}) {
  const { colors } = useTheme();
  const label = genre ?? ALL_GENRES;
  const active = genre !== null && !genreDisabled;
  const pill = (
    <View style={[styles.pill, { borderColor: colors.border, backgroundColor: active ? colors.accentSoft : colors.surface, opacity: genreDisabled ? 0.5 : 1 }]}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.pillLabel, { color: active ? colors.text : colors.textDim }]}>{label}</Text>
      <View style={styles.chevron}><Icon name="chevronRight" size={16} color={active ? colors.text : colors.textDim} /></View>
    </View>
  );
  const items = [
    { label: ALL_GENRES, selected: genre === null, onPress: () => onGenre(null) },
    ...genreMenu(genres, genre).map((name) => ({ label: name, selected: name === genre, onPress: () => onGenre(name) })),
  ];

  return (
    <View style={styles.row} onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}>
      <View style={styles.segmented}>
        <Segmented options={PERIODS} value={period} onChange={onPeriod} accessibilityLabel="Period" />
      </View>
      <View style={styles.genre}>
        {genreDisabled ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Genre" accessibilityState={{ disabled: true }} disabled>{pill}</Pressable>
        ) : (
          <Menu key={label.length} title="Genre" items={items}>{pill}</Menu>
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
