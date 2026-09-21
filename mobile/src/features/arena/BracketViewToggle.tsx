// Switches the bracket pane between the round-by-round draw and the
// classic whole-tree map. Labelled with the view it switches TO, not the
// one you are on: it sits in the round bar among chips that name what
// they select, and a chip reading "Rounds" while you are already looking
// at rounds would be the odd one out.

import { Pressable, StyleSheet, Text } from "react-native";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";

export type BracketView = "rounds" | "classic";

const COPY: Record<BracketView, { label: string; hint: string }> = {
  rounds: { label: "Rounds", hint: "Show the bracket round by round" },
  classic: { label: "Classic", hint: "Show the whole bracket at once" },
};

export function BracketViewToggle({ to, onPress }: { to: BracketView; onPress: () => void }) {
  const { colors } = useTheme();
  const copy = COPY[to];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.hint}
      hitSlop={6}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}
    >
      <Text {...dynamicType} style={[typography.caption, styles.bold, { color: colors.textDim }]}>{copy.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.full, borderWidth: 1 },
  bold: { fontWeight: "700" },
});
