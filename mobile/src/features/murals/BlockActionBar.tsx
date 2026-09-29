import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "../../ui";
import { Text } from "../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";

export type BlockAction = { key: string; label: string; icon: IconName; onPress: () => void; tone?: "danger" };

export function BlockActionBar({ actions }: { actions: BlockAction[] }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="toolbar" style={styles.bar}>
      {actions.map((action) => {
        const color = action.tone === "danger" ? colors.danger : colors.text;
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
          >
            <Icon name={action.icon} color={color} size={22} />
            <Text numberOfLines={1} style={[typography.caption, { color }]}>{action.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: "row" },
  action: { flex: 1, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.xs, borderRadius: radii.md },
});
