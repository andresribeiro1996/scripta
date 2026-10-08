import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import PagerView from "react-native-pager-view";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { hasChosen, readerCardPages, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase, type ReaderCardPage, type TurnState } from "@scripta/shared";
import { MOTION } from "@scripta/shared/themes";
import { minimumTouchTarget, radii, spacing, useReducedMotion, useTheme } from "../../ui";
import { PLATE_RATIO, ReaderCardImage } from "./ReaderCardImage";

const EASE = Easing.bezier(MOTION.ease[0], MOTION.ease[1], MOTION.ease[2], MOTION.ease[3]);
const TURN_MS = 450;
const DOT_ON_SCRIM = "#ffffff";

function turnToPage(state: TurnState, pages: ReaderCardPage[], page: ReaderCardPage): TurnState {
  const index = [pages.indexOf(page), pages.indexOf("merged")].find((found) => found >= 0) ?? 1;
  return turnTo(state, index, index > state.index ? 1 : -1);
}

export function ReaderCardTurner({ input, width, onScrim = false, page }: { input: ReaderCardBase; width: number; onScrim?: boolean; page?: { page: ReaderCardPage } }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const chosen = hasChosen(input.card.chosen);
  const pages = useMemo(() => readerCardPages(input.style.layout, input.view ?? "visitor", chosen).flat(), [input.style.layout, input.view, chosen]);
  const summary = useMemo(() => readerCardSummary(input).join(" "), [input]);
  const [turn, setTurn] = useState(() => (page ? turnToPage(startTurn(pages.length), pages, page.page) : startTurn(pages.length)));
  const [asked, setAsked] = useState(page);
  if (page !== asked) {
    setAsked(page);
    if (page) setTurn((state) => turnToPage(state, pages, page.page));
  }
  const rotation = useSharedValue(0);
  const pager = useRef<PagerView>(null);
  const announced = useRef(false);
  const isPager = input.style.layout === "book";

  useEffect(() => {
    rotation.set(reduced ? turn.rotation : withTiming(turn.rotation, { duration: TURN_MS, easing: EASE, reduceMotion: ReduceMotion.System }));
  }, [turn.rotation, reduced, rotation]);

  useEffect(() => {
    if (!isPager || !pager.current) return;
    if (reduced) pager.current.setPageWithoutAnimation(turn.index);
    else pager.current.setPage(turn.index);
  }, [turn.index, isPager, reduced]);

  useEffect(() => {
    if (!announced.current) {
      announced.current = true;
      return;
    }
    AccessibilityInfo.announceForAccessibility(`Page ${turn.index + 1} of ${pages.length}`);
  }, [turn.index, pages.length]);

  const faceA = useAnimatedStyle(() => ({ transform: [{ perspective: 1600 }, { rotateY: `${-rotation.get()}deg` }] }));
  const faceB = useAnimatedStyle(() => ({ transform: [{ perspective: 1600 }, { rotateY: `${180 - rotation.get()}deg` }] }));
  const size = { width, height: width * PLATE_RATIO };
  const dotColor = onScrim ? DOT_ON_SCRIM : colors.text;

  return (
    <View style={styles.turner}>
      {isPager ? (
        <PagerView ref={pager} initialPage={0} onPageSelected={(event) => { const index = event.nativeEvent.position; setTurn((state) => (state.index === index ? state : { ...state, index })); }} style={size}>
          {pages.map((page, i) => (
            <View key={i} collapsable={false} accessible accessibilityRole="image" accessibilityLabel={i === 0 ? `${summary} Page 1 of ${pages.length}.` : `Page ${i + 1} of ${pages.length}`}>
              <ReaderCardImage input={input} page={page} width={width} />
            </View>
          ))}
        </PagerView>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`${summary} Page ${turn.index + 1} of ${pages.length}.`} accessibilityHint="Turns the card" onPress={() => setTurn((state) => turnBy(state, 1, pages.length))} style={size}>
          <Animated.View style={[styles.face, faceA]}><ReaderCardImage input={input} page={pages[turn.faces[0]]!} width={width} /></Animated.View>
          <Animated.View style={[styles.face, faceB]}><ReaderCardImage input={input} page={pages[turn.faces[1]]!} width={width} /></Animated.View>
        </Pressable>
      )}
      <View style={styles.dots}>
        {pages.map((_, i) => (
          <Pressable key={i} accessibilityLabel={`Page ${i + 1}`} accessibilityRole="button" accessibilityState={{ selected: i === turn.index }} onPress={() => setTurn((state) => turnTo(state, i, i > state.index ? 1 : -1))} style={styles.dot}>
            <View style={[styles.dotMark, { backgroundColor: dotColor, opacity: i === turn.index ? 1 : 0.4 }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  turner: { alignItems: "center", gap: spacing.md },
  face: { ...StyleSheet.absoluteFill, backfaceVisibility: "hidden" },
  dots: { flexDirection: "row" },
  dot: { width: minimumTouchTarget, height: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  dotMark: { width: spacing.sm, height: spacing.sm, borderRadius: radii.full },
});
