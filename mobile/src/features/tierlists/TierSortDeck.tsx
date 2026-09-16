import { useState } from "react";
import type { TierDefinition, TierlistData } from "@scripta/shared";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { commitHaptic } from "../../ui/haptics";
import { EmptyState, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { authorOf, coverOf, keyOf, titleOf, type TierBook } from "./TierBoard";
import { angleFor, sectorFor } from "./tierSort";

const SWIPE_THRESHOLD = 120;
const FLY_OUT_SCALE = 4;

// One tier, parked at its own angle around the card. It carries the tap path
// as well as the preview: a ring you can only reach by dragging is unusable
// with a screen reader, and fiddly for anyone who'd rather aim than swipe.
function TierTarget({ tier, index, targeted, angle, radius, onPress }: {
  tier: TierDefinition;
  index: number;
  targeted: SharedValue<number>;
  angle: number;
  radius: number;
  onPress: () => void;
}) {
  const label = tier.label || "Untitled";
  const style = useAnimatedStyle(() => {
    const active = targeted.value === index;
    return {
      opacity: withTiming(active ? 1 : 0.5, { duration: 120 }),
      transform: [
        { translateX: radius * Math.sin(angle) },
        { translateY: -radius * Math.cos(angle) },
        { scale: withSpring(active ? 1.15 : 1) },
      ],
    };
  });

  return (
    <Animated.View style={[styles.target, { backgroundColor: tier.color }, style]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Assign to ${label}`} onPress={onPress} style={styles.targetHit}>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.strong, styles.targetLabel]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// Remounted per book (keyed by the caller), so each card starts centred rather
// than wherever the last one was flung.
function SortCard({ book, count, targeted, onAssign }: {
  book: TierBook;
  count: number;
  targeted: SharedValue<number>;
  onAssign: (index: number) => void;
}) {
  const { colors } = useTheme();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const cover = coverOf(book);

  const gesture = Gesture.Pan()
    .onUpdate((event) => {
      x.value = event.translationX;
      y.value = event.translationY;
      const distance = Math.sqrt(event.translationX * event.translationX + event.translationY * event.translationY);
      targeted.value = distance >= SWIPE_THRESHOLD ? sectorFor(event.translationX, event.translationY, count) : -1;
    })
    .onEnd(() => {
      const index = targeted.value;
      targeted.value = -1;
      if (index < 0) {
        x.value = withSpring(0);
        y.value = withSpring(0);
        return;
      }
      // Out along the direction it was thrown, rather than a fixed corner.
      x.value = withTiming(x.value * FLY_OUT_SCALE, { duration: 180 });
      y.value = withTiming(y.value * FLY_OUT_SCALE, { duration: 180 });
      scheduleOnRN(commitHaptic);
      scheduleOnRN(onAssign, index);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${x.value / 24}deg` }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityLabel={`${titleOf(book)} by ${authorOf(book)}. Drag towards a tier to assign it, or tap the tier.`}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
      >
        {cover
          ? <Image source={cover} style={styles.cover} contentFit="cover" />
          : <View style={[styles.cover, styles.coverFallback, { backgroundColor: colors.accentSoft }]}><Text {...dynamicType} style={{ color: colors.accent }}>{titleOf(book).charAt(0)}</Text></View>}
        <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.strong, styles.center, { color: colors.text }]}>{titleOf(book)}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{authorOf(book)}</Text>
      </Animated.View>
    </GestureDetector>
  );
}

export function TierSortDeck({ data, books, onAssign }: { data: TierlistData; books: TierBook[]; onAssign: (bookKey: string, tierId: string) => void }) {
  const { colors } = useTheme();
  const [ring, setRing] = useState({ width: 0, height: 0 });
  const targeted = useSharedValue(-1);

  const byKey = new Map(books.map((book) => [keyOf(book), book]));
  const pending = data.pool.filter((key) => byKey.has(key));
  const current = pending[0];
  const book = current ? byKey.get(current) : undefined;
  const count = data.tiers.length;
  const radius = Math.max(96, Math.min(ring.width, ring.height) / 2 - 44);

  function assign(index: number) {
    const tier = data.tiers[index];
    if (!current || !tier) return;
    onAssign(current, tier.id);
  }

  if (!count) return <EmptyState title="No tiers yet" body="Add a tier from the menu, then sort your pool into it." />;
  if (!book) return <EmptyState title="Nothing left to sort" body="Every book in this list already sits in a tier." />;

  return (
    <View style={styles.deck}>
      <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>
        {pending.length} {pending.length === 1 ? "book" : "books"} left · drag towards a tier, or tap one
      </Text>
      <View style={styles.ring} onLayout={(event) => setRing(event.nativeEvent.layout)}>
        {data.tiers.map((tier, index) => <TierTarget
          key={tier.id}
          tier={tier}
          index={index}
          targeted={targeted}
          angle={angleFor(index, count)}
          radius={radius}
          onPress={() => assign(index)}
        />)}
        <SortCard key={current} book={book} count={count} targeted={targeted} onAssign={assign} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { flex: 1, gap: spacing.sm },
  ring: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { width: 120, borderWidth: 1, borderRadius: radii.lg, padding: spacing.sm, alignItems: "center", gap: spacing.xs },
  cover: { width: 72, height: 104, borderRadius: radii.sm },
  coverFallback: { alignItems: "center", justifyContent: "center" },
  target: { position: "absolute", borderRadius: radii.full, overflow: "hidden" },
  targetHit: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  targetLabel: { color: "#fff" },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
});
