import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Animated, Dimensions, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { Input, Menu, type MenuItem } from "./components";
import { minimumTouchTarget, radii, spacing, useReducedMotion, useTheme } from "./theme";

const FAB_HEIGHT = 56;

export const searchDockClearance = minimumTouchTarget + spacing.lg * 2;
export const searchDockFabClearance = searchDockClearance + FAB_HEIGHT + spacing.lg;

export type SearchDockScrollProps = {
  keyboardShouldPersistTaps: "handled";
  keyboardDismissMode: "on-drag";
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
};

export function SearchDock({
  value,
  onChangeText,
  accessibilityLabel,
  placeholder,
  cycle,
  fab,
  hidden = false,
  onSubmitEditing,
  inputRef,
  children,
}: {
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  placeholder: string;
  cycle?: {
    icon: IconName;
    active: boolean;
    accessibilityLabel: string;
    accessibilityHint?: string;
    onPress?: () => void;
    menu?: { title: string; items: MenuItem[] };
  };
  fab?: ReactNode;
  hidden?: boolean;
  onSubmitEditing?: () => void;
  inputRef?: Ref<TextInput>;
  children: (scrollProps: SearchDockScrollProps) => ReactNode;
}) {
  const { colors } = useTheme();
  const frame = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const reducedMotion = useReducedMotion();
  const dock = useRef(new Animated.Value(1)).current;
  const input = useRef<TextInput | null>(null);
  const setInput = (node: TextInput | null) => {
    input.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };

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
    const hiding = Keyboard.addListener("keyboardDidHide", () => {
      setOverlap(0);
      input.current?.blur();
    });
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

  const cycleButton = cycle ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cycle.accessibilityLabel}
      accessibilityHint={cycle.accessibilityHint}
      onPress={cycle.onPress}
      style={[styles.cycle, { borderColor: colors.border, backgroundColor: cycle.active ? colors.accentSoft : colors.surface }]}
    >
      <Icon name={cycle.icon} size={20} color={cycle.active ? colors.text : colors.textDim} />
    </Pressable>
  ) : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.grow}>
      <View ref={frame} style={styles.grow}>
        <View style={styles.grow}>{children(scrollProps)}</View>
        {hidden ? null : (
          <Animated.View
            pointerEvents={scrolling ? "none" : "box-none"}
            style={[styles.dock, { bottom: overlap, opacity: dock, transform: [{ translateY: dock.interpolate({ inputRange: [0, 1], outputRange: [minimumTouchTarget, 0] }) }] }]}
          >
            {fab ? <View pointerEvents="box-none" style={styles.fabArea}>{fab}</View> : null}
            <View style={styles.row}>
              <View style={styles.grow}>
                <Input
                  icon="search"
                  accessibilityLabel={accessibilityLabel}
                  value={value}
                  onChangeText={onChangeText}
                  onSubmitEditing={onSubmitEditing}
                  onClear={() => onChangeText("")}
                  ref={setInput}
                  placeholder={placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.searchField}
                />
              </View>
              {cycleButton ? <View style={styles.cycleSlot}>{cycle?.menu ? <Menu title={cycle.menu.title} items={cycle.menu.items}>{cycleButton}</Menu> : cycleButton}</View> : null}
            </View>
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  dock: { position: "absolute", left: 0, right: 0 },
  fabArea: { height: FAB_HEIGHT + spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  searchField: { borderRadius: radii.full },
  cycleSlot: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  cycle: { alignItems: "center", justifyContent: "center", width: minimumTouchTarget, height: minimumTouchTarget, borderWidth: 1, borderRadius: radii.full },
});
