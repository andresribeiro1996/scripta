import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "../../ui";
import { Text } from "../../ui/Text";
import { radii, spacing, typography, useTheme } from "../../ui/theme";

export type BlockAction = { key: string; label: string; icon: IconName; onPress: () => void; tone?: "accent"; accessibilityLabel?: string };

export function BlockActionBar({ actions, disabled = false }: { actions: BlockAction[]; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="toolbar" style={styles.bar}>
      {actions.map((action) => {
        const accented = action.tone === "accent";
        const color = accented ? colors.accent : colors.text;
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, { opacity: disabled ? 0.55 : pressed ? 0.75 : 1, backgroundColor: accented ? colors.accentSoft : pressed ? colors.surfacePressed : "transparent" }]}
          >
            <Icon name={action.icon} color={color} size={20} />
            <Text numberOfLines={1} style={[typography.caption, { color, fontWeight: "600" }]}>{action.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: "row", gap: spacing.xs },
  action: { flex: 1, minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: radii.lg },
});
