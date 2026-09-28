import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Defs, G, Mask, Rect } from "react-native-svg";
import { ENTRANCE, FAN_EASE, MARK_BOOKPLATE, MARK_EXTRA_COLORS, MARK_RECTS, MARK_VIEWBOX, MOTION, layerEntrance, markTreatment, type MarkEntrance, type MarkFill, type MarkTreatment } from "@scripta/shared/themes";
import { entranceAvailable, markEntrancePlayed } from "./markEntrance";
import { useReducedMotion, useTheme, type ThemeColors } from "./theme";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const EASE = Easing.bezier(MOTION.ease[0], MOTION.ease[1], MOTION.ease[2], MOTION.ease[3]);
const UNITS = 84;

function color(fill: MarkFill, colors: ThemeColors): string {
  if (fill === "text") return colors.text;
  if (fill === "accent") return colors.accent;
  return MARK_EXTRA_COLORS[fill];
}

function MarkRects({ fill }: { fill: string }) {
  return (
    <>
      {MARK_RECTS.map((rect) => (
        <Rect key={`${rect.x},${rect.y}`} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={fill} transform={rect.rotate ? `rotate(${rect.rotate.join(" ")})` : undefined} />
      ))}
    </>
  );
}

function Layer({ treatment, index, size, colors, entrance }: { treatment: MarkTreatment; index: number; size: number; colors: ThemeColors; entrance: MarkEntrance | null }) {
  const layer = treatment.layers[index]!;
  const enter = entrance ? layerEntrance(treatment, index) : null;
  const gild = entrance === "gild";
  const progress = useSharedValue(enter || gild ? 0 : 1);
  useEffect(() => {
    if (enter) {
      const easing = entrance === "fan" ? Easing.bezier(FAN_EASE[0], FAN_EASE[1], FAN_EASE[2], FAN_EASE[3]) : EASE;
      progress.set(withDelay(enter.delayMs, withTiming(1, { duration: ENTRANCE[entrance!].ms, easing, reduceMotion: ReduceMotion.System })));
    } else if (gild) {
      progress.set(withDelay(ENTRANCE.gild.markDelayMs, withTiming(1, { duration: ENTRANCE.gild.markMs, easing: EASE, reduceMotion: ReduceMotion.System })));
    }
  }, []);
  const unit = size / UNITS;
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    if (gild) return { opacity: p };
    if (!enter) return {};
    return { opacity: enter.fade ? p : 1, transform: [{ translateX: (1 - p) * enter.from[0] * unit }, { translateY: (1 - p) * enter.from[1] * unit }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size} viewBox={MARK_VIEWBOX}>
        {treatment.stripes ? (
          <Defs>
            <Mask id="stripes" maskUnits="userSpaceOnUse" x={-4} y={-4} width={84} height={84}>
              <Rect x={-4} y={-4} width={84} height={84} fill="#fff" />
              {treatment.stripes.map(([y, height]) => (
                <Rect key={y} x={-4} y={y} width={84} height={height} fill="#000" />
              ))}
            </Mask>
          </Defs>
        ) : null}
        <G transform={treatment.bookplate ? MARK_BOOKPLATE.markTransform : undefined} mask={treatment.stripes ? "url(#stripes)" : undefined}>
          <G transform={`translate(${layer.offset[0]} ${layer.offset[1]})`} opacity={layer.opacity}>
            <MarkRects fill={color(layer.fill, colors)} />
          </G>
        </G>
      </Svg>
    </Animated.View>
  );
}

function Bookplate({ size, colors, draw }: { size: number; colors: ThemeColors; draw: boolean }) {
  const progress = useSharedValue(draw ? 0 : 1);
  useEffect(() => {
    if (draw) progress.set(withTiming(1, { duration: ENTRANCE.gild.ms, easing: EASE, reduceMotion: ReduceMotion.System }));
  }, []);
  const outerProps = useAnimatedProps(() => ({ strokeDashoffset: MARK_BOOKPLATE.outer.perimeter * (1 - progress.get()) }));
  const innerProps = useAnimatedProps(() => ({ strokeDashoffset: MARK_BOOKPLATE.inner.perimeter * (1 - progress.get()) }));
  return (
    <Svg width={size} height={size} viewBox={MARK_VIEWBOX} style={StyleSheet.absoluteFill}>
      {[
        [MARK_BOOKPLATE.outer, outerProps] as const,
        [MARK_BOOKPLATE.inner, innerProps] as const,
      ].map(([line, animatedProps]) => (
        <AnimatedRect
          key={line.size}
          x={line.x}
          y={line.y}
          width={line.size}
          height={line.size}
          rx={line.radius}
          fill="none"
          stroke={colors.accent}
          strokeWidth={line.stroke}
          strokeDasharray={`${line.perimeter} ${line.perimeter}`}
          animatedProps={animatedProps}
        />
      ))}
    </Svg>
  );
}

export function BrandMark({ size }: { size: number }) {
  const { id, colors } = useTheme();
  const reduced = useReducedMotion();
  const treatment = markTreatment(id);
  const [initialId] = useState(() => (entranceAvailable() ? id : null));
  const [themeChanged, setThemeChanged] = useState(false);
  if (initialId !== null && !themeChanged && id !== initialId) setThemeChanged(true);
  useEffect(() => {
    markEntrancePlayed();
  }, []);
  const entrance = id === initialId && !themeChanged && !reduced ? treatment.entrance : null;
  const reveal = useSharedValue(entrance === "scan" ? 0 : 1);
  const rise = useSharedValue(entrance === "rise" ? 0 : 1);
  useEffect(() => {
    if (entrance === "scan") reveal.set(withTiming(1, { duration: ENTRANCE.scan.ms, easing: Easing.steps(ENTRANCE.scan.steps, true), reduceMotion: ReduceMotion.System }));
    if (entrance === "rise") rise.set(withTiming(1, { duration: ENTRANCE.rise.ms, easing: EASE, reduceMotion: ReduceMotion.System }));
  }, []);
  const riseStyle = useAnimatedStyle(() => ({ opacity: rise.get(), transform: [{ translateY: (1 - rise.get()) * ENTRANCE.rise.from * (size / UNITS) }] }));
  const revealStyle = useAnimatedStyle(() => ({ height: size * reveal.get() }));
  return (
    <Animated.View style={[{ width: size, height: size }, riseStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ width: size, overflow: "hidden" }, revealStyle]}>
        <View style={{ width: size, height: size }}>
          {treatment.bookplate ? <Bookplate size={size} colors={colors} draw={entrance === "gild"} /> : null}
          {treatment.layers.map((_, index) => (
            <Layer key={index} treatment={treatment} index={index} size={size} colors={colors} entrance={entrance} />
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
}
