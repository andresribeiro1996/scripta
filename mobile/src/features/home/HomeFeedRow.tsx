import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { bookKey, participationLead, savedContentRef, type DigestItem } from "@scripta/shared";
import { contentDetail } from "@scripta/shared/community";
import { Text } from "../../ui/Text";
import { Button, Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { FeedPreview } from "./FeedPreview";
import { feedEventLabel, feedPrimaryLabel, feedRowAccessibilityLabel, feedRowModel, feedShareTarget, hasActivityThread, readingShelfBook, relativeTime } from "./feedRowModel";
import type { HomeActions } from "./useHomeActions";

export function FeedRow({ item, onOpen, actions, onComments, isSaved, onOpenProfile = openProfile }: { item: DigestItem; onOpen: () => void; actions: HomeActions; onComments?: () => void; isSaved?: boolean; onOpenProfile?: (username: string) => void }) {
  const { colors } = useTheme();
  const row = feedRowModel(item);
  const actor = item.kind === "participation" ? item.actors[0] : item.actor;
  const name = item.kind === "participation" ? participationLead(item) : actor?.username;
  const ref = savedContentRef(item);
  const saved = isSaved ?? (ref ? actions.savedKeys.has(`${ref.kind}:${ref.id}`) : false);
  const engagement = actions.engagement[item.id];
  const primary = feedPrimaryLabel(item);
  const title = item.kind === "vote" ? item.content.name : row.title;
  const detail = item.kind === "vote" ? contentDetail(item.content) : row.detail;
  const owned = item.kind === "reading" ? readingShelfBook(item.book, actions.library.data?.data.books ?? []) : undefined;
  const dense = item.kind === "reading" || item.kind === "vote" || item.kind === "participation" || (item.kind === "publication" && item.content.kind !== "tierlist");
  const filled = item.kind === "publication" && ((item.content.kind === "tierlist" && item.content.votingOpen) || (item.content.kind === "quiz" && item.content.playOpen));
  const bookmark = ref ? <Pressable accessibilityRole="button" accessibilityLabel={saved ? `Remove ${title} from saved` : `Save ${title} for later`} accessibilityState={{ selected: saved, disabled: actions.saving || (isSaved === undefined && !actions.savedReady) }} disabled={actions.saving || (isSaved === undefined && !actions.savedReady)} onPress={() => actions.toggleSaved(item, saved)} style={({ pressed }) => [styles.iconAction, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="bookmark" filled={saved} size={18} color={saved ? colors.accent : colors.textDim} /></Pressable> : null;
  const action = primary ? filled ? <View style={styles.primary}><Button label={primary} onPress={onOpen} /></View> : <Pressable accessibilityRole="link" onPress={onOpen} style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1 }]}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{primary} →</Text></Pressable> : null;
  const heading = title ? <Pressable accessibilityRole="link" accessibilityLabel={feedRowAccessibilityLabel(item)} onPress={onOpen} style={({ pressed }) => [styles.heading, { opacity: pressed ? 0.6 : 1 }]}><Text display {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{title}</Text></Pressable> : null;
  return <View style={[styles.post, { borderBottomColor: colors.border }]}>
    {item.kind === "completion" ? <View style={[styles.winnerLabel, { backgroundColor: colors.accentSoft }]}><Icon name="champion" size={16} color={colors.accent} /><Text {...dynamicType} style={[typography.caption, styles.grow, { color: colors.accent }]}>{feedEventLabel(item)}</Text>{bookmark}</View> : <View style={styles.actor}>
      <Pressable accessibilityRole="link" accessibilityLabel={actor && !actor.unavailable ? `Open ${actor.username}'s profile` : undefined} disabled={!actor || actor.unavailable} onPress={() => actor && onOpenProfile(actor.username)} style={({ pressed }) => [styles.reader, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}>
        {actor ? <AuthorAvatar username={actor.username} avatarUrl={actor.avatarUrl} /> : <Icon name="community" size={28} color={colors.textDim} />}
        <View style={[styles.grow, styles.readerText]}>
          <View style={styles.readerName}><Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.strong, styles.shrink, { color: colors.text }]}>{name}</Text>{actor && item.kind !== "participation" ? <ReaderGlyph identity={actor.readerGlyph} /> : null}</View>
          <Text {...dynamicType} style={[typography.caption, { color: item.kind === "reading" && item.finished ? colors.success : colors.textDim }]}>{feedEventLabel(item)}</Text>
        </View>
      </Pressable>
      <View style={styles.stamp}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{relativeTime(item.createdAt)}</Text></View>
      {bookmark}
    </View>}
    {item.kind === "follow" ? null : <View style={[styles.body, dense ? styles.bodyRow : styles.bodyColumn, item.kind === "completion" && styles.winnerBody]}>
      {item.kind === "publication" && item.content.kind === "tierlist" ? heading : null}
      <Pressable accessibilityRole="link" accessibilityLabel={`Open ${title}`} onPress={onOpen} style={({ pressed }) => [dense && styles.compactPreview, { opacity: pressed ? 0.75 : 1 }]}><FeedPreview item={item} /></Pressable>
      <View style={[styles.copy, (dense || item.kind === "completion") && styles.grow]}>
        {item.kind === "publication" && item.content.kind === "tierlist" ? null : heading}
        {detail ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{detail}</Text> : null}
        {item.kind === "completion" ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>You took part · {relativeTime(item.createdAt)}</Text> : null}
        {action}
        {item.kind === "reading" ? <Pressable accessibilityRole={owned ? "link" : "button"} accessibilityLabel={actions.wanting ? "Adding…" : owned ? "Open in your shelf" : "Want to read"} accessibilityState={{ disabled: actions.wanting }} disabled={actions.wanting} onPress={() => owned ? router.push(`/book/${encodeURIComponent(bookKey(owned))}` as never) : actions.wantToRead(item)} style={({ pressed }) => [styles.textAction, { opacity: pressed || actions.wanting ? 0.6 : 1 }]}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{actions.wanting ? "Adding…" : owned ? "Open in your shelf" : "Want to read"}</Text></Pressable> : null}
      </View>
    </View>}
    <View style={styles.reactions}>
      {hasActivityThread(item) ? <>
        <Pressable accessibilityRole="button" accessibilityLabel={engagement?.liked ? "Unlike this post" : "Like this post"} accessibilityState={{ selected: engagement?.liked, disabled: !engagement || actions.liking }} disabled={!engagement || actions.liking} onPress={() => actions.toggleLike(item)} style={({ pressed }) => [styles.reaction, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="like" filled={engagement?.liked} size={18} color={engagement?.liked ? colors.accent : colors.textDim} /><Text {...dynamicType} style={[typography.caption, styles.count, { color: colors.textDim }]}>{engagement?.likes ?? "…"}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={engagement ? `Comments, ${engagement.comments}` : "Comments"} onPress={onComments} style={({ pressed }) => [styles.reaction, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="comment" size={18} color={colors.textDim} /><Text {...dynamicType} style={[typography.caption, styles.count, { color: colors.textDim }]}>{engagement?.comments ?? "…"}</Text></Pressable>
      </> : null}
      {feedShareTarget(item) ? <Pressable accessibilityRole="button" accessibilityLabel={`Share ${title || "reader"}`} onPress={() => actions.share(item)} style={({ pressed }) => [styles.share, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="share" size={18} color={colors.textDim} /><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Share</Text></Pressable> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  post: { marginHorizontal: spacing.lg, paddingVertical: spacing.xl, borderBottomWidth: 1, gap: spacing.md },
  actor: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  reader: { flex: 1, minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.sm },
  readerText: { gap: spacing.xs },
  readerName: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "700" },
  stamp: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: "25%" },
  body: { gap: spacing.md },
  bodyRow: { flexDirection: "row", alignItems: "center" },
  bodyColumn: { flexDirection: "column" },
  compactPreview: { maxWidth: 132 },
  copy: { gap: spacing.xs },
  heading: { minHeight: minimumTouchTarget, justifyContent: "center" },
  primary: { alignSelf: "flex-start", paddingTop: spacing.xs },
  textAction: { minHeight: minimumTouchTarget, alignSelf: "flex-start", justifyContent: "center" },
  iconAction: { width: minimumTouchTarget, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  winnerLabel: { flexDirection: "row", gap: spacing.sm, alignItems: "center", borderRadius: radii.md, paddingLeft: spacing.md },
  winnerBody: { flexDirection: "row-reverse", alignItems: "center" },
  reactions: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  reaction: { minHeight: minimumTouchTarget, minWidth: 64, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.sm },
  count: { minWidth: 20, fontVariant: ["tabular-nums"] },
  share: { marginLeft: "auto", minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.sm }
});
