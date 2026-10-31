import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { Button, Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { activityRowModel, activitySentence, relativeTime, type PersonalItem } from "@scripta/shared/community";
import { useLocale } from "../../i18n";

export function ActivityRow({ item, isNew, following, onOpen, onFollowBack }: { item: PersonalItem; isNew: boolean; following: boolean; onOpen: () => void; onFollowBack: () => void }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const stacked = useWindowDimensions().fontScale > 1;
  const row = activityRowModel(item, locale);
  const avatar = item.kind === "follow" ? item.actor : item.kind === "participation" ? item.actors[0] : undefined;
  const time = relativeTime(item.createdAt, locale);
  return <View style={[styles.row, stacked ? styles.rowStacked : null, { borderBottomColor: colors.border }]}>
    <Pressable accessibilityRole="link" accessibilityLabel={`${activitySentence(row)}, ${time}`} onPress={onOpen} style={({ pressed }) => [styles.main, stacked ? styles.mainStacked : null, { opacity: pressed ? 0.6 : 1 }]}>
      {avatar ? <AuthorAvatar username={avatar.username} avatarUrl={avatar.avatarUrl} /> : <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><Icon name={item.kind === "completion" ? "champion" : "community"} size={16} color={colors.accent} /></View>}
      <View style={styles.copy}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.text }]}>{row.lead ? <Text style={styles.strong}>{row.lead} </Text> : null}{row.verb}{row.target ? <Text style={styles.strong}> {row.target}</Text> : null}</Text>
        <View style={styles.stamp}>{isNew ? <View style={[styles.newDot, { backgroundColor: colors.accent }]} /> : null}<Text {...dynamicType} numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{time}</Text></View>
      </View>
    </Pressable>
    {row.action.kind === "followBack" ? <Button variant="secondary" label="Follow back" numberOfLines={1} accessibilityLabel={`Follow ${row.lead} back`} loading={following} onPress={onFollowBack} />
      : row.action.kind === "following" ? <Text {...dynamicType} numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>Following</Text>
      : <Pressable accessibilityRole="link" onPress={onOpen} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}><Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.strong, { color: colors.accent }]}>{row.action.label} →</Text></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  row: { marginHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowStacked: { flexDirection: "column", alignItems: "flex-end" },
  main: { flex: 1, minWidth: 0, minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mainStacked: { flex: 0, alignSelf: "stretch" },
  link: { minHeight: minimumTouchTarget, justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  tile: { width: 28, height: 28, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  stamp: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  newDot: { width: 6, height: 6, borderRadius: radii.full },
  strong: { fontWeight: "700" }
});
