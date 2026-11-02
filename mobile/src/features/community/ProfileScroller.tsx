import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type FlatList } from "react-native";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Text } from "../../ui/Text";
import { dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { useScreenOptions } from "../../ui/navigation";
import { pinnedOffset } from "./pinnedOffset";

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
  const list = useRef<FlatList<unknown>>(null);
  const scrollY = useSharedValue(0);
  const pending = useRef<number | null>(null);
  const [heroHeight, setHeroHeight] = useState(0);
  const [viewport, setViewport] = useState(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const backdropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(scrollY.get(), 0) }] }));
  const rows: readonly unknown[] = [TAB_BAR, ...(section.data.length ? section.data : [EMPTY])];

  function settle() {
    const offset = pending.current;
    pending.current = null;
    if (offset === null) return;
    scrollY.set(offset);
    list.current?.scrollToOffset({ offset, animated: false });
  }

  useEffect(() => {
    const frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  function select(next: T) {
    const current = scrollY.get();
    pending.current = pinnedOffset(current, heroHeight) ?? current;
    onChange(next);
    if (next === value) settle();
  }

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
            onPress={() => select(tab.value)}
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
      <Animated.FlatList
        ref={list}
        style={[styles.root, { marginTop: headerHeight }]}
        contentContainerStyle={[styles.content, { minHeight: heroHeight + viewport }]}
        data={rows}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onScroll={onScroll}
        scrollEventThrottle={16}
        stickyHeaderIndices={[1]}
        refreshing={section.refreshing}
        onRefresh={section.onRefresh}
        onEndReached={section.onEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={<View onLayout={(event) => setHeroHeight(event.nativeEvent.layout.height)}>{hero}</View>}
        ListFooterComponent={section.ListFooterComponent}
        keyExtractor={(item, index) => (item === TAB_BAR ? "tab-bar" : item === EMPTY ? `${value}:empty` : `${value}:${section.keyExtractor(item, index - 1)}`)}
        renderItem={({ item, index }) => (item === TAB_BAR ? tabBar : item === EMPTY ? section.ListEmptyComponent ?? null : section.renderItem(item, index - 1))}
      />
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
