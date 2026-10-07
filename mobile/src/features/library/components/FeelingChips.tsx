import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import { FINISH_FEELINGS, type FinishRating } from "@scripta/shared";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";

export function FeelingChips({ value, onChange }: { value: number | null; onChange: (rating: FinishRating) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={styles.row}>
      {FINISH_FEELINGS.map(({ rating, label }) => {
        const selected = value === rating;
        return (
          <Pressable
            key={rating}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(rating)}
            style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
          >
            <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.label, { color: selected ? colors.accent : colors.text }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: minimumTouchTarget, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  label: { fontWeight: "700" }
});
