import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Dimensions, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { minimumTouchTarget, spacing, useReducedMotion } from "./theme";

export const scrollDockFabHeight = 56;

export type SearchDockScrollProps = {
  keyboardShouldPersistTaps: "handled";
  keyboardDismissMode: "on-drag";
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
};

export function ScrollDock({
  bar,
  fab,
  hidden = false,
  children,
}: {
  bar: ReactNode;
  fab?: ReactNode;
  hidden?: boolean;
  children: (scrollProps: SearchDockScrollProps) => ReactNode;
}) {
  const frame = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const reducedMotion = useReducedMotion();
  const dock = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      dock.setValue(scrolling ? 0 : 1);
      return;
    }
    Animated.timing(dock, { duration: 180, toValue: scrolling ? 0 : 1, useNativeDriver: true }).start();
  }, [dock, reducedMotion, scrolling]);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => {
      frame.current?.measureInWindow((_x, y, _width, height) => {
        setOverlap(Math.max(0, Math.min(height, y + height - (Dimensions.get("window").height - event.endCoordinates.height))));
      });
    });
    const hiding = Keyboard.addListener("keyboardDidHide", () => setOverlap(0));
    return () => {
      shown.remove();
      hiding.remove();
    };
  }, []);

  const scrollProps: SearchDockScrollProps = {
    keyboardShouldPersistTaps: "handled",
    keyboardDismissMode: "on-drag",
    onScrollBeginDrag: () => setScrolling(true),
    onScrollEndDrag: () => setScrolling(false),
    onMomentumScrollBegin: () => setScrolling(true),
    onMomentumScrollEnd: () => setScrolling(false),
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.grow}>
      <View ref={frame} style={styles.grow}>
        <View style={styles.grow}>{children(scrollProps)}</View>
        {hidden && !fab ? null : (
          <Animated.View
            pointerEvents={scrolling ? "none" : "box-none"}
            style={[styles.dock, { bottom: overlap, opacity: dock, transform: [{ translateY: dock.interpolate({ inputRange: [0, 1], outputRange: [minimumTouchTarget, 0] }) }] }]}
          >
            {fab ? <View pointerEvents="box-none" style={styles.fabArea}>{fab}</View> : null}
            {hidden ? null : bar}
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  dock: { position: "absolute", left: 0, right: 0 },
  fabArea: { height: scrollDockFabHeight + spacing.lg },
});
