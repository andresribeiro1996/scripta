import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { countdownLabel, type Duel } from "@scripta/shared";
import { commitHaptic } from "../../ui/haptics";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";

const SWIPE_THRESHOLD = 120;
const FLY_OUT_DISTANCE = 500;

function VoteCard({ duel, disabled, onVote }: { duel: Duel; disabled: boolean; onVote: (bookKey: string) => void }) {
  const { colors } = useTheme();
  const x = useSharedValue(0);

  const gesture = Gesture.Pan()
    .enabled(!disabled)
    // Horizontal only: a vertical drag belongs to the pane's own scroll.
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
      <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>Round {duel.roundNumber} · Match {duel.duelIndex + 1} · {countdownLabel(duel.closesAt)}</Text>
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
              <BookCover cover={duel.bookA.cover} title={duel.bookA.title} width={104} height={150} />
              <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, styles.center, { color: colors.text }]}>{duel.bookA.title}</Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{duel.bookA.author}</Text>
            </View>
            <Text {...dynamicType} style={[typography.title, { color: colors.textDim }]}>vs</Text>
            <View style={styles.half}>
              <BookCover cover={duel.bookB.cover} title={duel.bookB.title} width={104} height={150} />
              <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, styles.center, { color: colors.text }]}>{duel.bookB.title}</Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{duel.bookB.author}</Text>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
      <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>Swipe left or right to pick a winner</Text>
      <View style={styles.buttonsRow}>
        <Button label={`${duel.bookA.title} wins`} variant="secondary" loading={disabled} onPress={() => onVote(duel.bookA.key)} />
        <Button label={`${duel.bookB.title} wins`} variant="secondary" loading={disabled} onPress={() => onVote(duel.bookB.key)} />
      </View>
    </View>
  );
}

/** One card at a time, remounted per attempt: a swipe animates the card off
 *  screen, so both the next duel and a retry of this one need a fresh one
 *  back at centre. */
export function ArenaVoteDeck({ duel, disabled, onVote }: { duel: Duel; disabled: boolean; onVote: (bookKey: string) => void }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <VoteCard
      key={`${duel.id}:${attempt}`}
      duel={duel}
      disabled={disabled}
      onVote={(bookKey) => { setAttempt((n) => n + 1); onVote(bookKey); }}
    />
  );
}

const styles = StyleSheet.create({
  cardWrap: { gap: spacing.md },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg },
  halves: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  half: { flex: 1, alignItems: "center", gap: spacing.xs },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
  badge: { position: "absolute", top: spacing.md, zIndex: 1, borderWidth: 2, borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  badgeLeft: { left: spacing.md, transform: [{ rotate: "-8deg" }] },
  badgeRight: { right: spacing.md, transform: [{ rotate: "8deg" }] },
  buttonsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
});
