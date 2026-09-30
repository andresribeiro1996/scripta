import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { DigestItem } from "@scripta/shared";
import { ApiError } from "../../core/api";
import { Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { CoverFan, SLOT_HEIGHT, SLOT_WIDTH } from "../community/CoverFan";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { fetchDashboard, followUser } from "../community/api";
import { feedRowAccessibilityLabel, feedRowModel, relativeTime } from "./feedRowModel";

export function useDashboardFeed() {
  return useInfiniteQuery({
    queryKey: ["community", "dashboard"],
    queryFn: ({ pageParam }) => fetchDashboard(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchOnMount: "always",
  });
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
    } catch (reason) {
      setFollowError(reason instanceof ApiError ? reason.message : "Couldn't follow them. Try again.");
    } finally {
      setFollowingId(null);
    }
  }
  return { followingId, followError, followBack };
}

/** One activity row. The leading slot is always the same width and always
 *  starts at the same edge, so names line up down the feed; what fills it
 *  says how much the event is worth — a fan of covers for a publication, one
 *  for a book, the actor's avatar for anything that is only about them. A
 *  participation row gets its game's covers with the first participant on
 *  them, else up to three participants' avatars stacked, else a group icon. */
export function FeedRow({ item, onOpen, onFollowBack, following }: { item: DigestItem; onOpen: () => void; onFollowBack: () => void; following: boolean }) {
  const { colors } = useTheme();
  const row = feedRowModel(item);
  const labelColor = row.tone === "accent" ? colors.accent : row.tone === "success" ? colors.success : colors.textDim;
  const actor = item.kind === "participation" ? null : item.actor;
  const faces = item.kind === "participation" ? item.actors : [item.actor];
  const face = faces.at(0);

  return (
    <Pressable accessibilityRole="link" accessibilityLabel={feedRowAccessibilityLabel(item)} onPress={onOpen}>
      {({ pressed }) => (
        <View style={[styles.feedRow, { backgroundColor: pressed ? colors.surfacePressed : "transparent", borderBottomColor: colors.border }]}>
          <View style={styles.slot}>
            {row.covers.length ? (
              <>
                <CoverFan covers={row.covers} />
                {face ? (
                  <View style={[styles.slotAvatar, { borderColor: colors.background }]}>
                    <AuthorAvatar username={face.username} avatarUrl={face.avatarUrl} />
                  </View>
                ) : null}
              </>
            ) : faces.length > 1 ? (
              <View style={styles.stack}>
                {faces.map((person, index) => (
                  <View key={person.userId} style={[styles.stackAvatar, { borderColor: colors.background }, index > 0 && styles.stackOverlap]}>
                    <AuthorAvatar username={person.username} avatarUrl={person.avatarUrl} size={STACK_SIZE - 4} />
                  </View>
                ))}
              </View>
            ) : face ? (
              // Nothing to preview, so the actor stands in for the covers —
              // at avatar size, not the fan-sized slot, which dwarfed a face.
              <AuthorAvatar username={face.username} avatarUrl={face.avatarUrl} size={AVATAR_SIZE} />
            ) : (
              <Icon name="community" size={AVATAR_SIZE / 2} color={colors.textDim} />
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
            <View style={styles.nameRow}>
              {actor ? (
                <>
                  <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.metaName, { color: colors.textDim }]}>
                    {actor.username}
                  </Text>
                  <ReaderGlyph identity={actor.readerGlyph} />
                </>
              ) : null}
              {row.detail ? (
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.metaDetail, { color: colors.textDim }]}>
                  {actor ? ` · ${row.detail}` : row.detail}
                </Text>
              ) : null}
            </View>
            {actor && row.action === "followBack" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Follow ${actor.username} back`}
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
const AVATAR_SIZE = 44;
const STACK_SIZE = 36;
const STACK_OVERLAP = 12;

const styles = StyleSheet.create({
  grow: { flex: 1 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  slot: { width: SLOT_WIDTH, height: SLOT_HEIGHT, justifyContent: "center", alignItems: "center" },
  // Sized explicitly rather than left to the avatar inside it: a box that
  // takes its height from its child sits flush against the slot's bottom
  // edge, where the ring reads as a flattened circle.
  slotAvatar: { position: "absolute", left: 0, bottom: 4, width: BADGE_SIZE, height: BADGE_SIZE, alignItems: "center", justifyContent: "center", borderRadius: radii.full, borderWidth: 2, overflow: "hidden", zIndex: 10 },
  stack: { flexDirection: "row" },
  stackAvatar: { width: STACK_SIZE, height: STACK_SIZE, alignItems: "center", justifyContent: "center", borderRadius: radii.full, borderWidth: 2, overflow: "hidden" },
  stackOverlap: { marginLeft: -STACK_OVERLAP },
  heading: { fontWeight: "700" },
  // Centred, not baseline-aligned: a native symbol view has no text
  // baseline, and aligning to one collapses it to nothing.
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaName: { flexShrink: 1 },
  metaDetail: { flex: 1 },
  timestamp: { flexShrink: 0, marginLeft: "auto" },
  // Padded to clear the 44px floor: the label alone is a 16px-tall target.
  rowAction: { minHeight: minimumTouchTarget - spacing.lg, justifyContent: "center", paddingVertical: spacing.xs },
});
