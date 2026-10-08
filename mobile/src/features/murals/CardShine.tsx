import { StyleSheet, View } from "react-native";
import Animated, { Extrapolation, SensorType, interpolate, useAnimatedSensor, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { SHINE_STOPS, type ShineKind } from "@scripta/shared";
import { useReducedMotion } from "../../ui";

const GRAVITY = 9.81;
const TILT_X = GRAVITY * Math.sin((25 * Math.PI) / 180);

function Band({ kind, width, height }: { kind: ShineKind; width: number; height: number }) {
  return (
    <Svg width={width * 3} height={height}>
      <Defs>
        <LinearGradient id="shine" x1="0" y1="0" x2="1" y2="0.35">
          {SHINE_STOPS[kind].map(([offset, colour, opacity]) => <Stop key={offset} offset={offset} stopColor={colour} stopOpacity={opacity} />)}
        </LinearGradient>
      </Defs>
      <Rect width={width * 3} height={height} fill="url(#shine)" />
    </Svg>
  );
}

function LiveShine({ kind, width, height }: { kind: ShineKind; width: number; height: number }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: "auto" });
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(gravity.sensor.get().x, [-TILT_X, TILT_X], [-1.5 * width, -0.5 * width], Extrapolation.CLAMP) }] }));
  return <Animated.View style={band}><Band kind={kind} width={width} height={height} /></Animated.View>;
}

export function CardShine({ kind, width, height, live }: { kind: ShineKind; width: number; height: number; live: boolean }) {
  const reduced = useReducedMotion();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: (width * 4) / 250 }]}>
      {live && !reduced ? <LiveShine kind={kind} width={width} height={height} /> : <View style={{ transform: [{ translateX: -width }] }}><Band kind={kind} width={width} height={height} /></View>}
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: "hidden" } });
