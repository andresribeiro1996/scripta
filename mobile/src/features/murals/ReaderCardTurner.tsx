import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import PagerView from "react-native-pager-view";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { hasChosen, readerCardPages, readerCardShine, readerCardSummary, startTurn, turnBy, turnTo, turnToPage, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { MOTION } from "@scripta/shared/themes";
import { minimumTouchTarget, radii, spacing, useReducedMotion, useTheme } from "../../ui";
import { CardShine } from "./CardShine";
import { PLATE_RATIO, ReaderCardImage } from "./ReaderCardImage";

const EASE = Easing.bezier(MOTION.ease[0], MOTION.ease[1], MOTION.ease[2], MOTION.ease[3]);
const TURN_MS = 450;
const DOT_ON_SCRIM = "#ffffff";

export function ReaderCardTurner({ input, width, onScrim = false, page, liveShine = false }: { input: ReaderCardBase; width: number; onScrim?: boolean; page?: { page: ReaderCardPage }; liveShine?: boolean }) {
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
  const [initialPage] = useState(turn.index);
  const rotation = useSharedValue(turn.rotation);
  const pager = useRef<PagerView>(null);
  const announced = useRef(false);
  const isPager = input.style.layout === "book";

  const [rest, setRest] = useState(turn.rotation);

  useEffect(() => {
    rotation.set(reduced ? turn.rotation : withTiming(turn.rotation, { duration: TURN_MS, easing: EASE, reduceMotion: ReduceMotion.System }));
    const timer = setTimeout(() => setRest(turn.rotation), reduced ? 0 : TURN_MS + 100);
    return () => clearTimeout(timer);
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

  const size = { width, height: width * PLATE_RATIO };
  const shine = readerCardShine(input.style.finish);
  const shineOn = (page: ReaderCardPage) => (shine && page === "front" ? <CardShine kind={shine} width={width} height={width * PLATE_RATIO} live={liveShine} /> : null);
  const dotColor = onScrim ? DOT_ON_SCRIM : colors.text;

  return (
    <View style={styles.turner}>
      {isPager ? (
        <PagerView ref={pager} initialPage={initialPage} onPageSelected={(event) => { const index = event.nativeEvent.position; setTurn((state) => (state.index === index ? state : { ...state, index })); }} style={size}>
          {pages.map((page, i) => (
            <View key={i} collapsable={false} accessible accessibilityRole="image" accessibilityLabel={i === 0 ? `${summary} Page 1 of ${pages.length}.` : `Page ${i + 1} of ${pages.length}`}>
              <ReaderCardImage input={input} page={page} width={width} />
              {shineOn(page)}
            </View>
          ))}
        </PagerView>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`${summary} Page ${turn.index + 1} of ${pages.length}.`} accessibilityHint="Turns the card" onPress={() => setTurn((state) => turnBy(state, 1, pages.length))} style={size}>
          <CardFaces key={rest} rotation={rotation} faces={[<Fragment key="a"><ReaderCardImage input={input} page={pages[turn.faces[0]]!} width={width} />{shineOn(pages[turn.faces[0]]!)}</Fragment>, <Fragment key="b"><ReaderCardImage input={input} page={pages[turn.faces[1]]!} width={width} />{shineOn(pages[turn.faces[1]]!)}</Fragment>]} />
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

function CardFaces({ rotation, faces }: { rotation: SharedValue<number>; faces: [ReactNode, ReactNode] }) {
  const faceA = useAnimatedStyle(() => ({ transform: [{ perspective: 1600 }, { rotateY: `${-rotation.get()}deg` }] }));
  const faceB = useAnimatedStyle(() => ({ transform: [{ perspective: 1600 }, { rotateY: `${180 - rotation.get()}deg` }] }));
  return (
    <>
      <Animated.View style={[styles.face, faceA]}>{faces[0]}</Animated.View>
      <Animated.View style={[styles.face, faceB]}>{faces[1]}</Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  turner: { alignItems: "center", gap: spacing.md },
  face: { ...StyleSheet.absoluteFill, backfaceVisibility: "hidden" },
  dots: { flexDirection: "row" },
  dot: { width: minimumTouchTarget, height: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  dotMark: { width: spacing.sm, height: spacing.sm, borderRadius: radii.full },
});
