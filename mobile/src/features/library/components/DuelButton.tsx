import { Pressable, StyleSheet } from "react-native";
import { Text } from "../../../ui/Text";
import { dynamicType, radii, spacing, typography, useTheme } from "../../../ui/theme";

// Not the shared Button — that one sizes to its text, so "This one" (one
// line) and "Still <a long title>" (up to two) would render at different
// heights side by side. A fixed two-line-tall box with a clamped label
// keeps both halves of the duel the same size regardless of content.
export function DuelButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.duelButton,
        { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text {...dynamicType} numberOfLines={2} style={[typography.body, styles.duelButtonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  duelButton: { minHeight: 64, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  duelButtonText: { fontWeight: "600", textAlign: "center", alignSelf: "stretch" },
});
