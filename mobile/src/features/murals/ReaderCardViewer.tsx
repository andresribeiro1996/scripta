import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import PagerView from "react-native-pager-view";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hasChosen, readerCardPages, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase } from "@scripta/shared";
import { MOTION } from "@scripta/shared/themes";
import { Icon, minimumTouchTarget, radii, spacing, useReducedMotion, useTheme } from "../../ui";
import { PLATE_RATIO, ReaderCardImage } from "./ReaderCardImage";

const EASE = Easing.bezier(MOTION.ease[0], MOTION.ease[1], MOTION.ease[2], MOTION.ease[3]);
const TURN_MS = 450;

export function ReaderCardViewer({ input, onClose }: { input: ReaderCardBase; onClose: () => void }) {
  const { colors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const pages = useMemo(() => readerCardPages(input.style.layout, input.view ?? "visitor", hasChosen(input.card.chosen)).flat(), [input]);
  const summary = useMemo(() => readerCardSummary(input).join(" "), [input]);
  const [turn, setTurn] = useState(() => startTurn(pages.length));
  const rotation = useSharedValue(0);
  const pager = useRef<PagerView>(null);
  const announced = useRef(false);
  const isPager = input.style.layout === "book";
  const width = Math.max(0, Math.min(screenWidth - spacing.xl * 2, (screenHeight - insets.top - insets.bottom - 160) / PLATE_RATIO));

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

  return (
    <Modal animationType={reduced ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent transparent visible>
      <View style={[styles.backdrop, { backgroundColor: colors.scrim, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Pressable accessibilityLabel="Close reader card" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.content}>
          <Pressable accessibilityLabel="Close reader card" accessibilityRole="button" hitSlop={8} onPress={onClose} style={[styles.close, { backgroundColor: colors.surface }]}>
            <Icon name="close" color={colors.text} />
          </Pressable>
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
                <View style={[styles.dotMark, { backgroundColor: colors.text, opacity: i === turn.index ? 1 : 0.4 }]} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { alignItems: "center", gap: spacing.md },
  close: { alignSelf: "flex-end", minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  face: { ...StyleSheet.absoluteFill, backfaceVisibility: "hidden" },
  dots: { flexDirection: "row" },
  dot: { width: minimumTouchTarget, height: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  dotMark: { width: 8, height: 8, borderRadius: radii.full },
});
