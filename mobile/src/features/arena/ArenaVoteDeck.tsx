import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { countdownLabel, type Duel, type DuelSide } from "@scripta/shared";
import { commitHaptic } from "../../ui/haptics";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";

const SWIPE_THRESHOLD = 100;
const FLY_OUT_DISTANCE = 500;

function VoteHalf({
  side,
  winKey,
  loseKey,
  disabled,
  edge,
  onVote,
}: {
  side: DuelSide;
  winKey: string;
  loseKey: string;
  disabled: boolean;
  edge: "left" | "right";
  onVote: (bookKey: string) => void;
}) {
  const { colors } = useTheme();
  const y = useSharedValue(0);
  const committed = useSharedValue(false);
  const reducedMotion = useReducedMotion();

  const pan = Gesture.Pan()
    .enabled(!disabled)
    // Vertical only: a horizontal drag belongs to the tab pager above.
    .activeOffsetY([-10, 10])
    .failOffsetX([-15, 15])
    .onUpdate((event) => { if (!committed.get()) y.set(event.translationY); })
    .onEnd((event) => {
      if (committed.get()) return;
      const direction = event.translationY <= -SWIPE_THRESHOLD || event.velocityY < -850 && event.translationY < -30 ? -1
        : event.translationY >= SWIPE_THRESHOLD || event.velocityY > 850 && event.translationY > 30 ? 1 : 0;
      if (!direction) {
        y.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: event.velocityY, reduceMotion: ReduceMotion.System }));
        return;
      }
      committed.set(true);
      scheduleOnRN(commitHaptic);
      const bookKey = direction < 0 ? winKey : loseKey;
      if (reducedMotion) {
        scheduleOnRN(onVote, bookKey);
      } else {
        y.set(withTiming(direction * FLY_OUT_DISTANCE, { duration: 180 }, (finished) => {
          if (finished) scheduleOnRN(onVote, bookKey);
        }));
      }
    });
  // A tap is a drag that never crossed the pan's own activation offset, so
  // letting the pan try first and racing a tap alongside it resolves cleanly:
  // real drags activate the pan and the tap never fires, taps activate on
  // release with the pan still pending.
  const tap = Gesture.Tap().enabled(!disabled).onEnd(() => {
    scheduleOnRN(commitHaptic);
    scheduleOnRN(onVote, winKey);
  });

  const cardStyle = useAnimatedStyle(() => ({ transform: [
    { translateY: reducedMotion ? 0 : y.get() },
    { rotate: reducedMotion ? "0deg" : `${interpolate(y.get(), [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD], [-5, 0, 5], "clamp")}deg` },
    { scale: reducedMotion ? 1 : interpolate(Math.abs(y.get()), [0, SWIPE_THRESHOLD], [1, 1.03], "clamp") },
  ] }));
  const winTint = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [-SWIPE_THRESHOLD, -10], [0.25, 0], "clamp") }));
  const loseTint = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [10, SWIPE_THRESHOLD], [0, 0.25], "clamp") }));
  const winBadge = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [-SWIPE_THRESHOLD, -25], [1, 0], "clamp") }));
  const loseBadge = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [25, SWIPE_THRESHOLD], [0, 1], "clamp") }));

  const rounding = edge === "left"
    ? { borderTopLeftRadius: radii.lg, borderBottomLeftRadius: radii.lg }
    : { borderTopRightRadius: radii.lg, borderBottomRightRadius: radii.lg };

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${side.title} by ${side.author}`}
        accessibilityHint="Picks this book as the winner"
        onAccessibilityTap={() => onVote(winKey)}
        style={[styles.half, rounding, cardStyle]}
      >
        <BookCover cover={side.cover} title={side.title} fill />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.success }, winTint]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.danger }, loseTint]} />
        <Animated.View pointerEvents="none" style={[styles.badge, styles.badgeTop, { backgroundColor: colors.success }, winBadge]}><Text style={styles.badgeText}>WINS</Text></Animated.View>
        <Animated.View pointerEvents="none" style={[styles.badge, styles.badgeBottom, { backgroundColor: colors.danger }, loseBadge]}><Text style={styles.badgeText}>LOSES</Text></Animated.View>
        <View pointerEvents="none" style={[styles.scrim, { backgroundColor: colors.scrim }]} />
        <View pointerEvents="none" style={styles.textOverlay}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: "#ffffff" }]}>{side.title}</Text>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: "rgba(255,255,255,0.8)" }]}>{side.author}</Text>
        </View>
        <Text {...dynamicType} pointerEvents="none" style={[typography.caption, styles.center, styles.hintTop, { color: "rgba(255,255,255,0.85)" }]}>↑ wins</Text>
        <Text {...dynamicType} pointerEvents="none" style={[typography.caption, styles.center, styles.hintBottom, { color: "rgba(255,255,255,0.6)" }]}>↓ loses</Text>
      </Animated.View>
    </GestureDetector>
  );
}

/** One card at a time, remounted per attempt: a swipe animates a half off
 *  screen, so both the next duel and a retry of this one need fresh ones
 *  back at rest. */
export function ArenaVoteDeck({ duel, disabled, onVote }: { duel: Duel; disabled: boolean; onVote: (bookKey: string) => void }) {
  const { colors } = useTheme();
  const [attempt, setAttempt] = useState(0);
  const vote = (bookKey: string) => { setAttempt((n) => n + 1); onVote(bookKey); };

  return (
    <View key={`${duel.id}:${attempt}`} style={styles.wrap}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.center, { color: colors.text }]}>Round {duel.roundNumber} · Match {duel.duelIndex + 1} · {countdownLabel(duel.closesAt)}</Text>
      <View style={styles.row}>
        <VoteHalf side={duel.bookA} winKey={duel.bookA.key} loseKey={duel.bookB.key} disabled={disabled} edge="left" onVote={vote} />
        <VoteHalf side={duel.bookB} winKey={duel.bookB.key} loseKey={duel.bookA.key} disabled={disabled} edge="right" onVote={vote} />
        <View pointerEvents="none" style={[styles.vs, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.vsText, { color: colors.text }]}>VS</Text></View>
      </View>
      <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>Swipe a cover up to pick it, down to pass — or tap it</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  row: { aspectRatio: 1.3, flexDirection: "row", gap: 2 },
  half: { flex: 1, overflow: "hidden" },
  vs: { position: "absolute", alignSelf: "center", left: "50%", marginLeft: -19, width: 38, height: 38, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  vsText: { fontSize: 12, fontWeight: "700" },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
  hintTop: { position: "absolute", top: spacing.sm, left: 0, right: 0 },
  // Anchored just above the scrim band (not a fixed px offset) so it never
  // collides with the title when it wraps to two lines.
  hintBottom: { position: "absolute", bottom: "30%", left: 0, right: 0 },
  badge: { position: "absolute", alignSelf: "center", borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  badgeTop: { top: "38%" },
  badgeBottom: { bottom: "38%" },
  badgeText: { color: "#ffffff", fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "27%" },
  textOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.sm },
});
