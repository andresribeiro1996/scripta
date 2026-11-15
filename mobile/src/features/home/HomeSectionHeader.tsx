import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";

export function HomeSectionHeader({ title, linkLabel, onLink }: { title: string; linkLabel: string; onLink: () => void }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.header, fontScale > 1.3 && styles.stacked]}>
    <Text display accessibilityRole="header" {...dynamicType} style={[typography.title, styles.grow, { color: colors.text }]}>{title}</Text>
    <Pressable accessibilityRole="link" onPress={onLink} style={styles.action}><Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{linkLabel}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  header: { marginHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stacked: { flexDirection: "column", alignItems: "flex-start", gap: 0 },
  action: { minHeight: minimumTouchTarget, justifyContent: "center" },
  strong: { fontWeight: "700" },
  grow: { flex: 1, minWidth: 0 }
});
