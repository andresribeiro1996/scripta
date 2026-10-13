import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Animated, Dimensions, Keyboard, Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { Input } from "./components";
import { minimumTouchTarget, radii, spacing, useReducedMotion, useTheme } from "./theme";

const DOCK_HEIGHT = minimumTouchTarget + spacing.md * 2;
const FAB_HEIGHT = 56;

export const dockClearance = minimumTouchTarget + spacing.lg * 2;
export const dockFabClearance = DOCK_HEIGHT + FAB_HEIGHT + spacing.lg * 2;

export function useDockScroll() {
  const [scrolling, setScrolling] = useState(false);
  return {
    scrolling,
    scrollProps: {
      onScrollBeginDrag: () => setScrolling(true),
      onScrollEndDrag: () => setScrolling(false),
      onMomentumScrollBegin: () => setScrolling(true),
      onMomentumScrollEnd: () => setScrolling(false),
    },
  };
}

export function SearchDock({
  hidden,
  fab,
  trailing,
  ...input
}: Pick<ComponentProps<typeof Input>, "value" | "onChangeText" | "placeholder" | "accessibilityLabel"> & {
  hidden: boolean;
  fab?: ReactNode;
  trailing: ReactNode;
}) {
  const frame = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const reducedMotion = useReducedMotion();
  const visibility = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      visibility.setValue(hidden ? 0 : 1);
      return;
    }
    Animated.timing(visibility, { duration: 180, toValue: hidden ? 0 : 1, useNativeDriver: true }).start();
  }, [visibility, reducedMotion, hidden]);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => {
      frame.current?.measureInWindow((_x, y, _width, height) => {
        setOverlap(Math.max(0, Math.min(height, y + height - (Dimensions.get("window").height - event.endCoordinates.height))));
      });
    });
    const hiddenListener = Keyboard.addListener("keyboardDidHide", () => setOverlap(0));
    return () => {
      shown.remove();
      hiddenListener.remove();
    };
  }, []);

  return (
    <View ref={frame} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents={hidden ? "none" : "box-none"}
        style={[styles.layer, { bottom: overlap, opacity: visibility, transform: [{ translateY: visibility.interpolate({ inputRange: [0, 1], outputRange: [minimumTouchTarget, 0] }) }] }]}
      >
        {fab ? <View pointerEvents="box-none" style={[styles.fabArea, { bottom: DOCK_HEIGHT }]}>{fab}</View> : null}
        <View style={styles.dock}>
          <View style={styles.grow}>
            <Input icon="search" {...input} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" style={styles.searchField} />
          </View>
          {trailing}
        </View>
      </Animated.View>
    </View>
  );
}

export function RoundButton({
  icon,
  active,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: {
  icon: IconName;
  active: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={[styles.round, { borderColor: colors.border, backgroundColor: active ? colors.accentSoft : colors.surface }]}
    >
      <Icon name={icon} size={20} color={active ? colors.text : colors.textDim} />
    </Pressable>
  );
}

export function CycleButton<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; icon: IconName }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const index = options.findIndex((option) => option.value === value);
  const current = options[index];
  const next = options[(index + 1) % options.length];
  return (
    <RoundButton
      icon={current.icon}
      active={index > 0}
      accessibilityLabel={`Showing ${current.label.toLowerCase()}`}
      accessibilityHint="Switches to the next type"
      onPress={() => onChange(next.value)}
    />
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  layer: { position: "absolute", top: 0, left: 0, right: 0 },
  fabArea: { position: "absolute", top: 0, left: 0, right: 0 },
  dock: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  searchField: { borderRadius: radii.full },
  round: { alignItems: "center", justifyContent: "center", width: minimumTouchTarget, height: minimumTouchTarget, borderWidth: 1, borderRadius: radii.full },
});
