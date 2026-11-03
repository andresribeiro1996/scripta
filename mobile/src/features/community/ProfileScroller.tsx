import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Platform, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View, type FlatList } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Extrapolation, cancelAnimation, interpolate, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue, withDecay, withTiming, Easing, type AnimatedRef, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { useScreenOptions } from "../../ui/navigation";
import { dragX, settleDuration, swipeTarget, syncedOffset } from "./pinnedOffset";


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

export function elementSection(elements: readonly ReactElement[]): ProfileSection<ReactElement> {
  return { data: elements, keyExtractor: (element, index) => String(element.key ?? index), renderItem: (element) => element };
}

export const transparentHeader = { title: "", headerTransparent: true, headerStyle: { backgroundColor: "transparent" }, headerShadowVisible: false, headerLargeTitleEnabled: false };

export function usePlainHeader() {
  const screenOptions = useScreenOptions();
  return { headerTransparent: false, headerStyle: screenOptions.headerStyle, headerShadowVisible: screenOptions.headerShadowVisible, headerLargeTitleEnabled: screenOptions.headerLargeTitleEnabled };
}

function Page({ section, listRef, scrollY, contentHeight, fling, topSpace, minHeight }: {
  section: ProfileSection;
  listRef: AnimatedRef<FlatList<unknown>>;
  scrollY: SharedValue<number>;
  contentHeight: SharedValue<number>;
  fling: SharedValue<number>;
  topSpace: number;
  minHeight: number;
}) {
  const onScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      cancelAnimation(fling);
    },
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });
  return (
    <Animated.FlatList
      ref={listRef}
      style={styles.grow}
      contentContainerStyle={[styles.content, { minHeight }]}
      data={section.data}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={(_, height) => contentHeight.set(height)}
      refreshControl={section.onRefresh || Platform.OS === "android" ? <RefreshControl enabled={Boolean(section.onRefresh)} refreshing={section.refreshing ?? false} onRefresh={section.onRefresh} progressViewOffset={topSpace} /> : undefined}
      onEndReached={section.onEndReached}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={<View style={{ height: topSpace }} />}
      ListEmptyComponent={section.ListEmptyComponent}
      ListFooterComponent={section.ListFooterComponent}
      keyExtractor={(item, index) => section.keyExtractor(item, index)}
      renderItem={({ item, index }) => section.renderItem(item, index)}
    />
  );
}

export function ProfileScroller<T extends string>({ hero, backdrop, notice, tabs, value, onChange, sectionFor, accessibilityLabel }: {
  hero: ReactNode;
  backdrop: ReactNode;
  notice?: ReactNode;
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  sectionFor: (tab: T) => ProfileSection;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const orderKey = tabs.map((tab) => tab.value).join("\n");
  const order = useMemo(() => orderKey.split("\n") as T[], [orderKey]);
  const count = order.length;
  const index = Math.max(0, order.indexOf(value));
  const refs = tabs.map(() => useAnimatedRef<FlatList<unknown>>());
  const ys = tabs.map(() => useSharedValue(0));
  const heights = tabs.map(() => useSharedValue(0));
  const x = useSharedValue(index * width);
  const activeIndex = useSharedValue(index);
  const fling = useSharedValue(0);
  const downX = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const heroH = useSharedValue(0);
  const tabH = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const [heroHeight, setHeroHeight] = useState(0);
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [tabLayouts, setTabLayouts] = useState<readonly ({ x: number; width: number } | undefined)[]>([]);
  const measured = count > 1 && order.every((_, tabIndex) => tabLayouts[tabIndex]);

  const android = Platform.OS === "android";

  const activeScroll = () => {
    "worklet";
    const y = ys[activeIndex.get()]!.get();
    return android ? Math.max(y, 0) : y;
  };

  const syncOthers = () => {
    "worklet";
    const active = activeIndex.get();
    const activeY = Math.max(ys[active]!.get(), 0);
    for (let other = 0; other < count; other++) {
      if (other === active) continue;
      const target = syncedOffset(activeY, ys[other]!.get(), heroH.get());
      ys[other]!.set(target);
      scrollTo(refs[other]!, 0, target, false);
    }
  };

  const settle = (target: number, velocity: number) => {
    "worklet";
    activeIndex.set(target);
    const to = target * width;
    x.set(reducedMotion ? to : withTiming(to, { duration: settleDuration(Math.abs(to - x.get()), velocity), easing: Easing.out(Easing.cubic) }));
  };

  const jump = (target: number) => {
    "worklet";
    cancelAnimation(fling);
    cancelAnimation(x);
    syncOthers();
    settle(target, 0);
  };

  const collapseStyle = useAnimatedStyle(() => {
    const y = ys[activeIndex.get()]!.get();
    return { transform: [{ translateY: -Math.min(android ? Math.max(y, 0) : y, heroH.get()) }] };
  });

  const indicatorStyle = useAnimatedStyle(() => {
    if (!measured) return {};
    const input = order.map((_, tabIndex) => tabIndex);
    const progress = x.get() / width;
    return {
      transform: [
        { translateX: interpolate(progress, input, order.map((_, tabIndex) => tabLayouts[tabIndex]!.x + tabLayouts[tabIndex]!.width / 2 - 0.5), Extrapolation.CLAMP) },
        { scaleX: interpolate(progress, input, order.map((_, tabIndex) => tabLayouts[tabIndex]!.width), Extrapolation.CLAMP) },
      ],
    };
  });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -x.get() }] }));

  useAnimatedReaction(
    () => fling.get(),
    (current, previous) => {
      if (previous === null || current === previous) return;
      scrollTo(refs[activeIndex.get()]!, 0, Math.max(current, 0), false);
    },
  );

  useEffect(() => {
    scheduleOnUI(() => {
      "worklet";
      cancelAnimation(x);
      x.set(activeIndex.get() * width);
    });
  }, [width]);

  const sent = useRef<T[]>([]);

  useEffect(() => {
    const echoed = sent.current.indexOf(value);
    if (echoed >= 0) {
      sent.current.splice(0, echoed + 1);
      return;
    }
    const target = order.indexOf(value);
    if (target < 0) return;
    scheduleOnUI(() => {
      "worklet";
      if (activeIndex.get() !== target) jump(target);
    });
  }, [value, order]);

  const latest = useRef(onChange);
  latest.current = onChange;

  const gesture = useMemo(() => {
    const choose = (next: T) => {
      sent.current.push(next);
      latest.current(next);
    };
    return Gesture.Race(
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onTouchesDown((event) => {
          downX.set(event.allTouches[0]?.absoluteX ?? 0);
        })
        .onStart(() => {
          cancelAnimation(x);
          cancelAnimation(fling);
          syncOthers();
          startX.set(x.get());
        })
        .onUpdate((event) => {
          if (reducedMotion) return;
          x.set(dragX(startX.get(), event.absoluteX - downX.get(), count, width));
        })
        .onEnd((event, success) => {
          const current = activeIndex.get();
          const next = success ? swipeTarget(order, order[current]!, event.absoluteX - downX.get(), event.velocityX) : null;
          const target = next === null ? current : order.indexOf(next);
          settle(target, event.velocityX);
          if (next !== null) scheduleOnRN(choose, next);
        }),
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-12, 12])
        .onTouchesDown((event, manager) => {
          cancelAnimation(fling);
          const touchY = event.allTouches[0]?.y ?? -1;
          const bottom = headerHeight + heroH.get() + tabH.get() - Math.min(activeScroll(), heroH.get());
          if (touchY < headerHeight || touchY >= bottom) manager.fail();
        })
        .onStart(() => {
          startY.set(activeScroll());
        })
        .onUpdate((event) => {
          scrollTo(refs[activeIndex.get()]!, 0, Math.max(startY.get() - event.translationY, 0), false);
        })
        .onEnd((event) => {
          fling.set(activeScroll());
          fling.set(withDecay({ velocity: -event.velocityY, clamp: [0, Math.max(heights[activeIndex.get()]!.get() - viewportH.get(), 0)] }));
        }),
    );
  }, [headerHeight, width, reducedMotion, order, count]);

  function tap(tabIndex: number, next: T) {
    scheduleOnUI(jump, tabIndex);
    if (next !== value) sent.current.push(next);
    onChange(next);
  }

  return (
    <View style={styles.grow}>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={styles.grow}>
          <View pointerEvents="box-none" style={styles.header}>
            <Animated.View pointerEvents="none" style={[styles.backdrop, { height: headerHeight + heroHeight }, collapseStyle]}>
              {backdrop}
            </Animated.View>
            <View pointerEvents="box-none" style={[styles.clip, { top: headerHeight }]}>
              <Animated.View pointerEvents="box-none" style={collapseStyle}>
                <View
                  onLayout={(event) => {
                    heroH.set(event.nativeEvent.layout.height);
                    setHeroHeight(event.nativeEvent.layout.height);
                  }}
                >
                  {hero}
                </View>
                <View
                  accessibilityLabel={accessibilityLabel}
                  accessibilityRole="tablist"
                  onLayout={(event) => {
                    tabH.set(event.nativeEvent.layout.height);
                    setTabBarHeight(event.nativeEvent.layout.height);
                  }}
                  style={[styles.tabRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
                >
                  {tabs.map((tab, tabIndex) => {
                    const selected = tab.value === value;
                    return (
                      <Pressable
                        key={tab.value}
                        accessibilityLabel={tab.label}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        onLayout={(event) => {
                          const { x: left, width: tabWidth } = event.nativeEvent.layout;
                          setTabLayouts((previous) => previous[tabIndex]?.x === left && previous[tabIndex]?.width === tabWidth ? previous : Object.assign([...previous], { [tabIndex]: { x: left, width: tabWidth } }));
                        }}
                        onPress={() => tap(tabIndex, tab.value)}
                        style={({ pressed }) => [styles.tab, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
                      >
                        <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.tabLabel, { color: selected ? colors.accent : colors.textDim }]}>
                          {tab.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {measured ? <Animated.View style={[styles.tabIndicator, { backgroundColor: colors.accent }, indicatorStyle]} /> : null}
                </View>
              </Animated.View>
            </View>
          </View>
          <View
            onLayout={(event) => {
              viewportH.set(event.nativeEvent.layout.height);
              setViewport(event.nativeEvent.layout.height);
            }}
            style={[styles.pages, { marginTop: headerHeight }]}
          >
            <Animated.View style={[styles.row, { width: width * count }, rowStyle]}>
              {tabs.map((tab, tabIndex) => (
                <View
                  key={tab.value}
                  accessibilityElementsHidden={tab.value !== value}
                  importantForAccessibility={tab.value === value ? "auto" : "no-hide-descendants"}
                  style={{ width }}
                >
                  <Page
                    section={sectionFor(tab.value)}
                    listRef={refs[tabIndex]!}
                    scrollY={ys[tabIndex]!}
                    contentHeight={heights[tabIndex]!}
                    fling={fling}
                    topSpace={heroHeight + tabBarHeight}
                    minHeight={heroHeight + viewport}
                  />
                </View>
              ))}
            </Animated.View>
          </View>
        </View>
      </GestureDetector>
      {notice ? <View pointerEvents="box-none" style={[styles.notice, { top: headerHeight }]}>{notice}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  header: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0 },
  clip: { position: "absolute", left: 0, right: 0, bottom: 0, overflow: "hidden" },
  pages: { flex: 1, overflow: "hidden" },
  row: { flex: 1, flexDirection: "row" },
  notice: { position: "absolute", left: 0, right: 0 },
  content: { paddingBottom: spacing.huge },
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  tabLabel: { fontWeight: "700" },
  tabIndicator: { position: "absolute", left: 0, bottom: 0, height: 3, width: 1 },
});
