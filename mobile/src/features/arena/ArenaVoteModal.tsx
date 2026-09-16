import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Duel, DuelSide } from "@scripta/shared";
import { commitHaptic } from "../../ui/haptics";
import { Button, EmptyState, ModalBody, Sheet, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";

const SWIPE_THRESHOLD = 120;
const FLY_OUT_DISTANCE = 500;

function Cover({ side }: { side: DuelSide }) {
  const { colors } = useTheme();
  return side.cover
    ? <Image source={side.cover} style={styles.cover} contentFit="cover" />
    : <View style={[styles.cover, styles.coverFallback, { backgroundColor: colors.accentSoft }]}><Text {...dynamicType} style={{ color: colors.accent }}>{side.title.charAt(0)}</Text></View>;
}

function VoteCard({ duel, disabled, onVote }: { duel: Duel; disabled: boolean; onVote: (bookKey: string) => void }) {
  const { colors } = useTheme();
  const x = useSharedValue(0);

  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onUpdate((event) => { x.value = event.translationX; })
    .onEnd((event) => {
      if (event.translationX <= -SWIPE_THRESHOLD) {
        x.value = withTiming(-FLY_OUT_DISTANCE, { duration: 180 });
        scheduleOnRN(commitHaptic);
        scheduleOnRN(onVote, duel.bookA.key);
      } else if (event.translationX >= SWIPE_THRESHOLD) {
        x.value = withTiming(FLY_OUT_DISTANCE, { duration: 180 });
        scheduleOnRN(commitHaptic);
        scheduleOnRN(onVote, duel.bookB.key);
      } else {
        x.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { rotate: `${x.value / 20}deg` }] }));
  const leftBadge = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-SWIPE_THRESHOLD, -20], [1, 0], "clamp") }));
  const rightBadge = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [20, SWIPE_THRESHOLD], [0, 1], "clamp") }));

  return (
    <View style={styles.cardWrap}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, cardStyle]}>
          <Animated.View pointerEvents="none" style={[styles.badge, styles.badgeLeft, { borderColor: colors.success, backgroundColor: colors.successSoft }, leftBadge]}>
            <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.success }]}>VOTE</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.badge, styles.badgeRight, { borderColor: colors.success, backgroundColor: colors.successSoft }, rightBadge]}>
            <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.success }]}>VOTE</Text>
          </Animated.View>
          <View style={styles.halves}>
            <View style={styles.half}>
              <Cover side={duel.bookA} />
              <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, styles.center, { color: colors.text }]}>{duel.bookA.title}</Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{duel.bookA.author}</Text>
            </View>
            <Text {...dynamicType} style={[typography.title, { color: colors.textDim }]}>vs</Text>
            <View style={styles.half}>
              <Cover side={duel.bookB} />
              <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, styles.center, { color: colors.text }]}>{duel.bookB.title}</Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{duel.bookB.author}</Text>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
      <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>Swipe left or right to pick a winner</Text>
      <View style={styles.buttonsRow}>
        <Button label={`${duel.bookA.title} wins`} variant="secondary" disabled={disabled} onPress={() => onVote(duel.bookA.key)} />
        <Button label={`${duel.bookB.title} wins`} variant="secondary" disabled={disabled} onPress={() => onVote(duel.bookB.key)} />
      </View>
    </View>
  );
}

export function ArenaVoteModal({ visible, duels, busy, error, onVote, onClose }: {
  visible: boolean;
  duels: Duel[];
  busy: string | null;
  error: string | null;
  onVote: (duel: Duel, bookKey: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [queue, setQueue] = useState<Duel[]>(duels);
  const [total, setTotal] = useState(duels.length);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (visible) {
      setQueue(duels);
      setTotal(duels.length);
    }
    // Deliberately not depending on `duels`: the queue should hold steady for
    // the length of a voting session even as background polling refreshes it.
  }, [visible]);

  const current = queue[0] ?? null;

  async function vote(bookKey: string) {
    if (!current || busy) return;
    setAttempt((n) => n + 1);
    const ok = await onVote(current, bookKey);
    if (ok) setQueue((remaining) => remaining.slice(1));
  }

  return (
    <Sheet visible={visible} title={current ? `Vote · ${total - queue.length + 1} of ${total}` : "Voting"} onClose={onClose}>
      <ModalBody>
        {error ? <Toast visible message={error} tone="error" /> : null}
        {current
          ? <VoteCard key={`${current.id}:${attempt}`} duel={current} disabled={busy === current.id} onVote={(bookKey) => void vote(bookKey)} />
          : <EmptyState title="All caught up" body="No matches left to vote on right now." actionLabel="Done" onAction={onClose} />}
      </ModalBody>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  cardWrap: { gap: spacing.md },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg },
  halves: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  half: { flex: 1, alignItems: "center", gap: spacing.xs },
  cover: { width: 96, height: 136, borderRadius: radii.md },
  coverFallback: { alignItems: "center", justifyContent: "center" },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
  badge: { position: "absolute", top: spacing.md, zIndex: 1, borderWidth: 2, borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  badgeLeft: { left: spacing.md, transform: [{ rotate: "-8deg" }] },
  badgeRight: { right: spacing.md, transform: [{ rotate: "8deg" }] },
  buttonsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
});
