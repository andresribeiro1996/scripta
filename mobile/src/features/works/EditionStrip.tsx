import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { editionLabel, type BookScreenModel, type WorkEdition } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Menu, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { CoverImage } from "../library/components/CoverImage";

const COVER_WIDTH = 112;
const COVER_HEIGHT = 168;
const INTERVAL = COVER_WIDTH + spacing.lg;
const DOT = 6;
const NEIGHBOUR_SCALE = 0.88;
const NEIGHBOUR_OPACITY = 0.6;

export function EditionStrip({ editions, book, edition, onSelect }: { editions: WorkEdition[]; book: Record<string, unknown> | null; edition: NonNullable<BookScreenModel["edition"]>; onSelect: (bookId: string) => void }) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const scroll = useRef<ScrollViewInstance>(null);
  const { index, label, showDots, mineIndex } = edition;
  const [initialOffset] = useState({ x: index * INTERVAL, y: 0 });
  const select = (i: number) => {
    onSelect(editions[Math.min(Math.max(i, 0), editions.length - 1)].bookId);
  };

  useEffect(() => {
    scroll.current?.scrollTo({ x: index * INTERVAL, animated: true });
  }, [index]);

  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => select(Math.round(event.nativeEvent.contentOffset.x / INTERVAL));
  const onDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { x } = event.nativeEvent.contentOffset;
    if (Math.abs(x - Math.round(x / INTERVAL) * INTERVAL) < 1) select(Math.round(x / INTERVAL));
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={INTERVAL}
        decelerationRate="fast"
        contentOffset={initialOffset}
        onMomentumScrollEnd={onSettle}
        onScrollEndDrag={onDragEnd}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Editions"
        accessibilityValue={{ text: label }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => select(index + (event.nativeEvent.actionName === "increment" ? 1 : -1))}
        style={{ width: windowWidth, flexGrow: 0 }}
        contentContainerStyle={[styles.strip, { paddingHorizontal: (windowWidth - COVER_WIDTH) / 2 }]}
      >
        {editions.map((item, i) => {
          const current = i === index;
          const cover = i === mineIndex && book ? (
            <View style={[styles.cover, { backgroundColor: colors.border }]}>
              <CoverImage book={book} size="full" />
            </View>
          ) : (
            <BookCover cover={item.coverUrl} title={item.title} width={COVER_WIDTH} height={COVER_HEIGHT} />
          );
          return (
            <Pressable
              key={item.bookId}
              disabled={current}
              onPress={() => select(i)}
              style={current ? null : { opacity: NEIGHBOUR_OPACITY, transform: [{ scale: NEIGHBOUR_SCALE }] }}
            >
              {cover}
            </Pressable>
          );
        })}
      </ScrollView>
      {showDots ? (
        <View importantForAccessibility="no-hide-descendants" style={styles.dots}>
          {editions.map((item, i) => (
            <View key={item.bookId} style={[styles.dot, { backgroundColor: i === index ? colors.text : colors.textDim, opacity: i === index ? 1 : 0.4 }]} />
          ))}
        </View>
      ) : null}
      <Menu
        key={label.length}
        title="Editions"
        items={editions.map((item, i) => ({
          label: `${item.title} · ${editionLabel(item)}${item.mine ? " · Yours" : ""}`,
          selected: i === index,
          onPress: () => select(i),
        }))}
      >
        <View style={styles.target}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{label} ▾</Text>
        </View>
      </Menu>
      {mineIndex !== null && index !== mineIndex ? (
        <Pressable accessibilityRole="button" onPress={() => select(mineIndex)} style={styles.target}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.back, { color: colors.accent }]}>Back to your edition</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: spacing.xs },
  strip: { gap: spacing.lg },
  cover: { width: COVER_WIDTH, height: COVER_HEIGHT, borderRadius: radii.sm, overflow: "hidden" },
  dots: { flexDirection: "row", gap: spacing.xs },
  dot: { width: DOT, height: DOT, borderRadius: radii.full },
  target: { minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  back: { fontWeight: "700" },
});
