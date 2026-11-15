import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";

export function HomeSectionHeader({ title, linkLabel, onLink }: { title: string; linkLabel: string; onLink: () => void }) {
  const { colors } = useTheme();
  return <View style={styles.header}>
    <Text display accessibilityRole="header" {...dynamicType} style={[typography.title, styles.grow, { color: colors.text }]}>{title}</Text>
    <Pressable accessibilityRole="link" onPress={onLink} style={styles.action}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{linkLabel}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  header: { marginHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  action: { minHeight: minimumTouchTarget, justifyContent: "center" },
  strong: { fontWeight: "700" },
  grow: { flex: 1, minWidth: 0 }
});
