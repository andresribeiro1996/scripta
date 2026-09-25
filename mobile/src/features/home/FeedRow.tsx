import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { digestHeading, digestTarget, type DigestItem } from "@scripta/shared";
import { Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { CoverFan, SLOT_HEIGHT, SLOT_WIDTH } from "../community/CoverFan";
import { followUser } from "../community/api";
import { feedRowModel, relativeTime } from "./feedRowModel";

// Mobile's profile route is /u/<name>; the shared target is the web app's
// /community/u/<name>, so the two kinds that point at a person are remapped.
export function digestRoute(item: DigestItem): string {
  return item.kind === "follow" || item.kind === "reading" ? `/u/${item.actor.username}` : digestTarget(item);
}

export function useFollowBack(refetch: () => Promise<unknown>) {
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  // Refetches rather than patching the row in place: the follow lands as an
  // event of its own, so the feed has more to say afterwards than just this
  // row's new state.
  async function followBack(userId: string) {
    setFollowingId(userId);
    try {
      await followUser(userId);
      await refetch();
    } catch {
      setFollowError("Couldn't follow them. Try again.");
    } finally {
      setFollowingId(null);
    }
  }
  return { followingId, followError, followBack };
}

/** One activity row. The leading slot is always the same width and always
 *  starts at the same edge, so names line up down the feed; what fills it
 *  says how much the event is worth — a fan of covers for a publication, one
 *  for a book, the actor's avatar for anything that is only about them. */
export function FeedRow({ item, onOpen, onFollowBack, following }: { item: DigestItem; onOpen: () => void; onFollowBack: () => void; following: boolean }) {
  const { colors } = useTheme();
  const row = feedRowModel(item);
  const labelColor = row.tone === "accent" ? colors.accent : row.tone === "success" ? colors.success : colors.textDim;

  return (
    <Pressable accessibilityRole="link" accessibilityLabel={digestHeading(item)} onPress={onOpen}>
      {({ pressed }) => (
        <View style={[styles.feedRow, { backgroundColor: pressed ? colors.surfacePressed : "transparent", borderBottomColor: colors.border }]}>
          <View style={styles.slot}>
            {row.covers.length ? (
              <>
                <CoverFan covers={row.covers} />
                <View style={[styles.slotAvatar, { borderColor: colors.background }]}>
                  <AuthorAvatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} />
                </View>
              </>
            ) : (
              // Nothing to preview, so the actor fills the slot the covers
              // would have taken rather than leaving it mostly empty.
              <AuthorAvatar username={item.actor.username} avatarUrl={item.actor.avatarUrl} size={SLOT_HEIGHT} />
            )}
          </View>
          <View style={styles.grow}>
            <View style={styles.labelRow}>
              <Icon name={row.icon} size={14} color={labelColor} />
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.heading, { color: labelColor }]}>
                {row.label}
              </Text>
              <Text {...dynamicType} style={[typography.caption, styles.timestamp, { color: colors.textDim }]}>
                {relativeTime(item.createdAt)}
              </Text>
            </View>
            {row.title ? (
              <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.heading, { color: colors.text }]}>
                {row.title}
              </Text>
            ) : null}
            <Text numberOfLines={2} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
              {row.meta}
            </Text>
            {row.action === "followBack" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Follow ${item.actor.username} back`}
                accessibilityState={{ busy: following }}
                disabled={following}
                hitSlop={spacing.sm}
                onPress={onFollowBack}
                style={styles.rowAction}
              >
                <Text {...dynamicType} style={[typography.caption, styles.heading, { color: following ? colors.textDim : colors.accent }]}>
                  {following ? "Following…" : "Follow back"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const BADGE_SIZE = 32;

const styles = StyleSheet.create({
  grow: { flex: 1 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  slot: { width: SLOT_WIDTH, height: SLOT_HEIGHT, justifyContent: "center" },
  // Sized explicitly rather than left to the avatar inside it: a box that
  // takes its height from its child sits flush against the slot's bottom
  // edge, where the ring reads as a flattened circle.
  slotAvatar: { position: "absolute", left: 0, bottom: 4, width: BADGE_SIZE, height: BADGE_SIZE, alignItems: "center", justifyContent: "center", borderRadius: radii.full, borderWidth: 2, overflow: "hidden", zIndex: 10 },
  heading: { fontWeight: "700" },
  // Centred, not baseline-aligned: a native symbol view has no text
  // baseline, and aligning to one collapses it to nothing.
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  timestamp: { flexShrink: 0, marginLeft: "auto" },
  // Padded to clear the 44px floor: the label alone is a 16px-tall target.
  rowAction: { minHeight: minimumTouchTarget - spacing.lg, justifyContent: "center", paddingVertical: spacing.xs },
});
