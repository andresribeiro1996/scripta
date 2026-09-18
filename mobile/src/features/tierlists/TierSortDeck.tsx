import { useEffect, useRef, useState } from "react";
import type { TierDefinition, TierlistData } from "@scripta/shared";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { commitHaptic, liftHaptic } from "../../ui/haptics";
import { EmptyState, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { authorOf, coverOf, keyOf, titleOf, type TierBook } from "./TierBoard";

const TARGET_SIZE = 56;

function TierTarget({ tier, index, targeted, onPress }: {
  tier: TierDefinition;
  index: number;
  targeted: SharedValue<number>;
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(targeted.get() === index ? 1.18 : 1, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }) }],
  }));
  return <Animated.View style={[styles.target, { backgroundColor: tier.color }, style]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Rank in ${tier.label || "Untitled"}`} onPress={onPress} style={styles.targetHit}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.targetLabel]}>{tier.label || "Untitled"}</Text>
    </Pressable>
  </Animated.View>;
}

function DragBook({ book, x, y, lifted }: {
  book: TierBook;
  x: SharedValue<number>;
  y: SharedValue<number>;
  lifted: SharedValue<boolean>;
}) {
  const { colors } = useTheme();
  const cover = coverOf(book);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { scale: withSpring(lifted.get() ? 1.08 : 1, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }) },
    ],
  }));
  return <Animated.View accessibilityLabel={`${titleOf(book)} by ${authorOf(book)}. Long press in the lower half, then drag into a tier; or tap a tier.`} style={style}>
    {cover ? <Image source={cover} style={styles.cover} contentFit="cover" /> : <View style={[styles.cover, styles.fallback, { backgroundColor: colors.accentSoft }]}><Text numberOfLines={4} {...dynamicType} style={[typography.caption, styles.center, { color: colors.accent }]}>{titleOf(book)}</Text></View>}
  </Animated.View>;
}

export function TierSortDeck({ data, books, onAssign, selectedBookKey }: { data: TierlistData; books: TierBook[]; onAssign: (bookKey: string, tierId: string) => void; selectedBookKey?: string | null }) {
  const ringRef = useRef<View>(null);
  const zones = useSharedValue<Array<{ x: number; y: number }>>([]);
  const center = useSharedValue({ x: 0, y: 0 });
  const [ring, setRing] = useState({ width: 0, height: 0 });
  const targeted = useSharedValue(-1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const lifted = useSharedValue(false);
  const byKey = new Map(books.map((book) => [keyOf(book), book]));
  const pending = data.pool.filter((key) => byKey.has(key));
  const current = selectedBookKey && byKey.has(selectedBookKey) ? selectedBookKey : pending[0];
  const book = current ? byKey.get(current) : undefined;
  const radius = Math.max(0, Math.min(ring.width, ring.height) / 2 - TARGET_SIZE / 2 - spacing.xs);

  useEffect(() => {
    if (!ring.width || !ring.height) return;
    const frame = requestAnimationFrame(() => ringRef.current?.measureInWindow((left, top, width, height) => {
      center.set({ x: left + width / 2, y: top + height / 2 });
      zones.set(data.tiers.map((_, index) => {
        const angle = index * 2 * Math.PI / data.tiers.length;
        return { x: left + width / 2 + radius * Math.sin(angle), y: top + height / 2 - radius * Math.cos(angle) };
      }));
    }));
    return () => cancelAnimationFrame(frame);
  }, [ring.width, ring.height, radius, data.tiers.length, center, zones]);

  function assign(index: number) {
    const tier = data.tiers[index];
    if (current && tier) onAssign(current, tier.id);
  }

  const gesture = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart((event) => {
      if (event.absoluteY < center.get().y) return;
      lifted.set(true);
      x.set(event.absoluteX - center.get().x);
      y.set(event.absoluteY - center.get().y);
      scheduleOnRN(liftHaptic);
    })
    .onUpdate((event) => {
      if (!lifted.get()) return;
      x.set(event.absoluteX - center.get().x);
      y.set(event.absoluteY - center.get().y);
      let next = -1;
      let nearest = 56 * 56;
      const targets = zones.get();
      for (let index = 0; index < data.tiers.length; index++) {
        const zone = targets[index];
        if (!zone) continue;
        const distance = (event.absoluteX - zone.x) ** 2 + (event.absoluteY - zone.y) ** 2;
        if (distance < nearest) { nearest = distance; next = index; }
      }
      targeted.set(next);
    })
    .onEnd(() => {
      const index = targeted.get();
      if (lifted.get() && index >= 0) { scheduleOnRN(commitHaptic); scheduleOnRN(assign, index); }
    })
    .onFinalize(() => {
      x.set(withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }));
      y.set(withSpring(0, { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System }));
      lifted.set(false);
      targeted.set(-1);
    });

  if (!data.tiers.length) return <EmptyState title="No tiers yet" body="Add a tier from the menu, then rank your books." />;
  if (!book) return <EmptyState title="Nothing left to rank" body="Every book in this list already sits in a tier." />;

  return <View style={styles.deck}>
    <Text {...dynamicType} style={[typography.caption, styles.center]}>{selectedBookKey ? "Choose a new tier · drag or tap a circle" : `${pending.length} ${pending.length === 1 ? "book" : "books"} left · long press below, then drag up`}</Text>
    <GestureDetector gesture={gesture}><View ref={ringRef} style={styles.ring} onLayout={(event) => setRing(event.nativeEvent.layout)}>
      <DragBook key={current} book={book} x={x} y={y} lifted={lifted} />
      {data.tiers.map((tier, index) => <View key={tier.id} style={[styles.targetWrap, { transform: [{ translateX: radius * Math.sin(index * 2 * Math.PI / data.tiers.length) }, { translateY: -radius * Math.cos(index * 2 * Math.PI / data.tiers.length) }] }]}>
        <TierTarget tier={tier} index={index} targeted={targeted} onPress={() => assign(index)} />
      </View>)}
    </View></GestureDetector>
  </View>;
}

const styles = StyleSheet.create({
  deck: { flex: 1, gap: spacing.sm },
  ring: { flex: 1, alignItems: "center", justifyContent: "center" },
  targetWrap: { position: "absolute" },
  target: { width: TARGET_SIZE, height: TARGET_SIZE, borderRadius: radii.full },
  targetHit: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs },
  targetLabel: { color: "#fff", textAlign: "center" },
  cover: { width: 80, height: 120, borderRadius: radii.sm },
  fallback: { alignItems: "center", justifyContent: "center", padding: spacing.xs },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
});
