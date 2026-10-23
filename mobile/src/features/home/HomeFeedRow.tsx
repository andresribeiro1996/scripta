import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { bookKey, participationLead, savedContentRef, type DigestItem } from "@scripta/shared";
import { contentDetail } from "@scripta/shared/community";
import { Text } from "../../ui/Text";
import { Button, Icon, captionHitSlop, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { FeedPreview } from "./FeedPreview";
import { feedEventLabel, feedPrimaryLabel, feedRowAccessibilityLabel, feedRowModel, feedShareTarget, hasActivityThread, reactionCount, readingShelfBook, relativeTime } from "./feedRowModel";
import type { HomeActions } from "./useHomeActions";

const readerHitSlop = { top: spacing.sm };
const bookmarkHitSlop = { top: spacing.md, left: 6, right: 6 };
const headingHitSlop = { top: spacing.sm, bottom: spacing.xs };
const linkHitSlop = { ...captionHitSlop, top: spacing.xl, bottom: spacing.sm };
const reactionHitSlop = { bottom: spacing.md };

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
  const bookmark = ref ? <Pressable accessibilityRole="button" accessibilityLabel={saved ? `Remove ${title} from saved` : `Save ${title} for later`} accessibilityState={{ selected: saved, disabled: actions.saving || (isSaved === undefined && !actions.savedReady) }} disabled={actions.saving || (isSaved === undefined && !actions.savedReady)} hitSlop={bookmarkHitSlop} onPress={() => actions.toggleSaved(item, saved)} style={({ pressed }) => [styles.iconAction, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="bookmark" filled={saved} size={18} color={saved ? colors.accent : colors.textDim} /></Pressable> : null;
  const action = primary ? filled ? <View style={styles.primary}><Button label={primary} onPress={onOpen} /></View> : <Pressable accessibilityRole="link" hitSlop={linkHitSlop} onPress={onOpen} style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1 }]}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{primary} →</Text></Pressable> : null;
  const heading = title ? <Pressable accessibilityRole="link" accessibilityLabel={feedRowAccessibilityLabel(item)} hitSlop={headingHitSlop} onPress={onOpen} style={({ pressed }) => [styles.heading, { opacity: pressed ? 0.6 : 1 }]}><Text display {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{title}</Text></Pressable> : null;
  const mural = item.kind === "mural";
  const likes = reactionCount(engagement?.likes);
  const comments = reactionCount(engagement?.comments);
  return <View style={[styles.post, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    {item.kind === "completion" ? <View style={[styles.winnerLabel, { backgroundColor: colors.accentSoft }]}><Icon name="champion" size={16} color={colors.accent} /><Text {...dynamicType} style={[typography.caption, styles.grow, { color: colors.accent }]}>{feedEventLabel(item)}</Text>{bookmark}</View> : <View style={[styles.actor, styles.inset]}>
      <Pressable accessibilityRole="link" accessibilityLabel={actor && !actor.unavailable ? `Open ${actor.username}'s profile` : undefined} disabled={!actor || actor.unavailable} hitSlop={readerHitSlop} onPress={() => actor && onOpenProfile(actor.username)} style={({ pressed }) => [styles.reader, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}>
        {actor ? <AuthorAvatar username={actor.username} avatarUrl={actor.avatarUrl} /> : <Icon name="community" size={28} color={colors.textDim} />}
        <View style={[styles.grow, styles.readerText]}>
          <View style={styles.readerName}><Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.strong, styles.shrink, { color: colors.text }]}>{name}</Text>{actor && item.kind !== "participation" ? <ReaderGlyph identity={actor.readerGlyph} /> : null}</View>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{feedEventLabel(item)}</Text>
        </View>
      </Pressable>
      <View style={styles.stamp}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{relativeTime(item.createdAt)}</Text></View>
      {bookmark}
    </View>}
    {item.kind === "follow" ? null : <View style={[styles.body, !mural && styles.inset, dense ? styles.bodyRow : styles.bodyColumn, item.kind === "completion" && styles.winnerBody]}>
      {item.kind === "publication" && item.content.kind === "tierlist" ? heading : null}
      <Pressable accessibilityRole="link" accessibilityLabel={`Open ${title}`} onPress={onOpen} style={({ pressed }) => [dense && styles.compactPreview, { opacity: pressed ? 0.75 : 1 }]}><FeedPreview item={item} /></Pressable>
      <View style={[styles.copy, mural && styles.inset, (dense || item.kind === "completion") && styles.grow]}>
        {item.kind === "publication" && item.content.kind === "tierlist" ? null : heading}
        {detail ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{detail}</Text> : null}
        {item.kind === "completion" ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>You took part · {relativeTime(item.createdAt)}</Text> : null}
        {action}
        {item.kind === "reading" ? owned
          ? <Pressable accessibilityRole="link" hitSlop={linkHitSlop} onPress={() => router.push(`/book/${encodeURIComponent(bookKey(owned))}` as never)} style={({ pressed }) => [styles.textAction, !detail && styles.shelfGap, { opacity: pressed ? 0.6 : 1 }]}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>Open in your shelf →</Text></Pressable>
          : <View style={styles.primary}><Button variant="secondary" label="Want to read" loading={actions.wanting} onPress={() => actions.wantToRead(item)} /></View>
        : null}
      </View>
    </View>}
    <View style={[styles.reactions, styles.inset]}>
      {hasActivityThread(item) ? <>
        <Pressable accessibilityRole="button" accessibilityLabel={engagement?.liked ? "Unlike this post" : "Like this post"} accessibilityState={{ selected: engagement?.liked, disabled: !engagement || actions.liking }} disabled={!engagement || actions.liking} hitSlop={reactionHitSlop} onPress={() => actions.toggleLike(item)} style={({ pressed }) => [styles.reaction, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="like" filled={engagement?.liked} size={18} color={engagement?.liked ? colors.accent : colors.textDim} />{likes ? <Text {...dynamicType} style={[typography.caption, styles.count, { color: colors.textDim }]}>{likes}</Text> : null}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={engagement ? `Comments, ${engagement.comments}` : "Comments"} hitSlop={reactionHitSlop} onPress={onComments} style={({ pressed }) => [styles.reaction, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="comment" size={18} color={colors.textDim} />{comments ? <Text {...dynamicType} style={[typography.caption, styles.count, { color: colors.textDim }]}>{comments}</Text> : null}</Pressable>
      </> : null}
      {feedShareTarget(item) ? <Pressable accessibilityRole="button" accessibilityLabel={`Share ${title || "reader"}`} hitSlop={reactionHitSlop} onPress={() => actions.share(item)} style={({ pressed }) => [styles.share, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}><Icon name="share" size={18} color={colors.textDim} /><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Share</Text></Pressable> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  post: { marginHorizontal: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderRadius: radii.xl, gap: spacing.sm },
  inset: { paddingHorizontal: spacing.md },
  actor: { paddingTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  reader: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.sm },
  readerText: { gap: spacing.xs },
  readerName: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "700" },
  stamp: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: "25%" },
  body: { gap: spacing.md },
  bodyRow: { flexDirection: "row", alignItems: "center" },
  bodyColumn: { flexDirection: "column" },
  compactPreview: { alignItems: "flex-start" },
  copy: { gap: spacing.xs },
  heading: { minHeight: 32, justifyContent: "center" },
  primary: { alignSelf: "flex-start", paddingTop: spacing.xs },
  textAction: { alignSelf: "flex-start", justifyContent: "center" },
  shelfGap: { marginTop: spacing.xl },
  iconAction: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  winnerLabel: { flexDirection: "row", gap: spacing.sm, alignItems: "center", borderTopLeftRadius: radii.xl - 1, borderTopRightRadius: radii.xl - 1, paddingTop: spacing.md, paddingLeft: spacing.md, paddingRight: spacing.sm },
  winnerBody: { flexDirection: "row-reverse", alignItems: "center" },
  reactions: { paddingBottom: spacing.md, flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  reaction: { minHeight: 32, minWidth: 64, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.sm },
  count: { minWidth: 20, fontVariant: ["tabular-nums"] },
  share: { marginLeft: "auto", minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.sm }
});
