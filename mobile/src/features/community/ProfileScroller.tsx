import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Platform, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View, type FlatList } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { useScreenOptions } from "../../ui/navigation";
import { pinnedOffset, rubberBand, swipeTarget } from "./pinnedOffset";

const SLIDE_DISTANCE = 24;
const SLIDE_DURATION = 180;
const OUT_DISTANCE = 0.35;
const OUT_DURATION = 120;
const SPRING_BACK = { damping: 20, mass: 1, stiffness: 100 } as const;

function slideIn(from: number) {
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ translateX: from }] },
      animations: { opacity: withTiming(1, { duration: SLIDE_DURATION }), transform: [{ translateX: withTiming(0, { duration: SLIDE_DURATION }) }] },
    };
  };
}

function SectionRow<T extends string>({ tab, drag, dragTab, leaving, width, from, children }: {
  tab: T;
  drag: SharedValue<number>;
  dragTab: SharedValue<T | null>;
  leaving: SharedValue<T | null>;
  width: number;
  from: number;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const x = dragTab.get() === tab ? drag.get() : 0;
    return { opacity: leaving.get() === tab ? 0 : 1 - Math.min(Math.abs(x) / width, 1) * 0.6, transform: [{ translateX: x }] };
  });
  return <Animated.View entering={from ? slideIn(from) : undefined} style={style}>{children}</Animated.View>;
}

export type ProfileSection<T = unknown> = {
  data: readonly T[];
  keyExtractor(item: T, index: number): string;
  renderItem(item: T, index: number): ReactElement | null;
  onEndReached?(): void;
  ListEmptyComponent?: ReactElement;
  ListFooterComponent?: ReactElement;
  refreshing?: boolean;
  onRefresh?(): void;
};

const TAB_BAR = Symbol("tabBar");
const EMPTY = Symbol("empty");

export function elementSection(elements: readonly ReactElement[]): ProfileSection<ReactElement> {
  return { data: elements, keyExtractor: (element, index) => String(element.key ?? index), renderItem: (element) => element };
}

export const transparentHeader = { title: "", headerTransparent: true, headerStyle: { backgroundColor: "transparent" }, headerShadowVisible: false, headerLargeTitleEnabled: false };

export function usePlainHeader() {
  const screenOptions = useScreenOptions();
  return { headerTransparent: false, headerStyle: screenOptions.headerStyle, headerShadowVisible: screenOptions.headerShadowVisible, headerLargeTitleEnabled: screenOptions.headerLargeTitleEnabled };
}

export function ProfileScroller<T extends string>({ hero, backdrop, notice, tabs, value, onChange, section, accessibilityLabel }: {
  hero: ReactNode;
  backdrop: ReactNode;
  notice?: ReactNode;
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  section: ProfileSection;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const list = useAnimatedRef<FlatList<unknown>>();
  const scrollY = useSharedValue(0);
  const leaving = useSharedValue<T | null>(null);
  const heroTop = useSharedValue(0);
  const drag = useSharedValue(0);
  const dragTab = useSharedValue<T | null>(null);
  const downX = useSharedValue(0);
  const order = tabs.map((tab) => tab.value);
  const tabState = useSharedValue({ order, value });
  const { width } = useWindowDimensions();
  const slideFrom = useRef(0);
  const reducedMotion = useReducedMotion();
  const [heroHeight, setHeroHeight] = useState(0);
  const [viewport, setViewport] = useState(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const backdropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(scrollY.get(), 0) }] }));
  const rows: readonly unknown[] = [TAB_BAR, ...(section.data.length ? section.data : [EMPTY])];

  useEffect(() => {
    slideFrom.current = 0;
  }, [value]);

  useEffect(() => {
    tabState.set({ order, value });
  });

  function select(next: T) {
    const offset = pinnedOffset(scrollY.get(), heroHeight);
    const from = offset !== null && next !== value ? value : null;
    const direction = Math.sign(tabs.findIndex((tab) => tab.value === next) - tabs.findIndex((tab) => tab.value === value));
    slideFrom.current = reducedMotion ? 0 : direction * SLIDE_DISTANCE;
    scheduleOnUI(() => {
      leaving.set(from);
      requestAnimationFrame(() => {
        if (offset !== null) {
          scrollY.set(offset);
          scrollTo(list, 0, offset, false);
        }
        scheduleOnRN(onChange, next);
      });
    });
  }

  function tap(next: T) {
    cancelAnimation(drag);
    dragTab.set(null);
    select(next);
  }

  const latest = useRef(select);
  latest.current = select;

  const swipe = useMemo(() => {
    const choose = (next: T) => latest.current(next);
    return Gesture.Pan()
      .activeOffsetX([-12, 12])
      .failOffsetY([-12, 12])
      .onTouchesDown((event, manager) => {
        const touch = event.allTouches[0];
        if ((touch?.y ?? 0) + scrollY.get() < heroTop.get()) manager.fail();
        downX.set(touch?.absoluteX ?? 0);
      })
      .onStart(() => {
        cancelAnimation(drag);
        drag.set(0);
        dragTab.set(tabState.get().value);
      })
      .onUpdate((event) => {
        if (reducedMotion) return;
        const { order: tabOrder, value: current } = tabState.get();
        const index = tabOrder.indexOf(current);
        const dx = event.absoluteX - downX.get();
        drag.set(rubberBand(dx, dx > 0 ? index <= 0 : index >= tabOrder.length - 1));
      })
      .onEnd((event, success) => {
        const { order: tabOrder, value: current } = tabState.get();
        const target = success ? swipeTarget(tabOrder, current, event.absoluteX - downX.get(), event.velocityX) : null;
        if (target === null) {
          drag.set(withSpring(0, SPRING_BACK));
          return;
        }
        const pinned = pinnedOffset(scrollY.get(), heroTop.get()) !== null;
        if (!reducedMotion) {
          const out = (tabOrder.indexOf(target) > tabOrder.indexOf(current) ? -1 : 1) * width * OUT_DISTANCE;
          drag.set(withTiming(out, { duration: OUT_DURATION }, (finished) => {
            if (finished && pinned) scheduleOnRN(choose, target);
          }));
        }
        if (reducedMotion || !pinned) scheduleOnRN(choose, target);
      });
  }, [scrollY, heroTop, drag, dragTab, downX, tabState, reducedMotion, width]);

  const tabBar = (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="tablist" style={[styles.tabRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => tap(tab.value)}
            style={({ pressed }) => [styles.tab, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
          >
            <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.tabLabel, { color: selected ? colors.accent : colors.textDim }]}>
              {tab.label}
            </Text>
            {selected ? <View style={[styles.tabIndicator, { backgroundColor: colors.accent }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={styles.root}>
      <Animated.View pointerEvents="none" style={[styles.backdrop, { height: headerHeight + heroHeight }, backdropStyle]}>
        {backdrop}
      </Animated.View>
      <GestureDetector gesture={swipe}>
      <View collapsable={false} style={[styles.root, { marginTop: headerHeight }]}>
      <Animated.FlatList
        ref={list}
        style={styles.root}
        contentContainerStyle={[styles.content, { minHeight: heroHeight + viewport }]}
        data={rows}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onScroll={onScroll}
        scrollEventThrottle={16}
        stickyHeaderIndices={[1]}
        refreshControl={section.onRefresh || Platform.OS === "android" ? <RefreshControl enabled={Boolean(section.onRefresh)} refreshing={section.refreshing ?? false} onRefresh={section.onRefresh} /> : undefined}
        onEndReached={section.onEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={<View onLayout={(event) => { heroTop.set(event.nativeEvent.layout.height); setHeroHeight(event.nativeEvent.layout.height); }}>{hero}</View>}
        ListFooterComponent={section.ListFooterComponent}
        keyExtractor={(item, index) => (item === TAB_BAR ? "tab-bar" : item === EMPTY ? `${value}:empty` : `${value}:${section.keyExtractor(item, index - 1)}`)}
        renderItem={({ item, index }) => (item === TAB_BAR ? tabBar : <SectionRow tab={value} drag={drag} dragTab={dragTab} leaving={leaving} width={width} from={slideFrom.current}>{item === EMPTY ? section.ListEmptyComponent ?? null : section.renderItem(item, index - 1)}</SectionRow>)}
      />
      </View>
      </GestureDetector>
      {notice ? <View pointerEvents="box-none" style={[styles.notice, { top: headerHeight }]}>{notice}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0 },
  notice: { position: "absolute", left: 0, right: 0 },
  content: { paddingBottom: spacing.huge },
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  tabLabel: { fontWeight: "700" },
  tabIndicator: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3 },
});
