import { useState } from "react";
import {
  BLOCK_TYPE_LABELS,
  resolveHomeBlock,
  type Group,
  GRID_COLUMNS,
  bookKey,
  computeStat,
  resolveBlockStyle,
  resolveQuote,
  resolveQuoteCollection,
  resolveShelfBooks,
  STAT_METRIC_LABELS,
  type BlockLayout,
  type Mural,
  type MuralBlock,
} from "@scripta/shared";
import { CoverImage } from "../library/components/CoverImage";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { commitHaptic, liftHaptic } from "../../ui/haptics";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { resolveBorderColor, resolveBorderStyle } from "../../ui/libraryStyle";
import { minimumTouchTarget, spacing, typography, useTheme } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import type { Tierlist } from "../tierlists/api";
import { muralCanvasHeight } from "./layout";

const LIFT_SPRING = { duration: 300, dampingRatio: 0.8 } as const;
const ROW_HEIGHT = 36;
const GAP = 8;

export function BlockContent({ block, books, images, tierlists, statsOverride }: { block: MuralBlock; books: Array<Record<string, unknown>>; images: GalleryImage[]; tierlists: Tierlist[]; statsOverride?: Record<string, number> }) {
  const { colors: themeColors } = useTheme();
  const colors = { ...themeColors, text: block.style?.textColor ?? themeColors.text };
  const title = (book: Record<string, unknown> | undefined) => String(book?.Title ?? "Book unavailable");
  if (block.type === "text") return <><Text style={[styles.blockTitle, { color: colors.text }]}>{block.heading || "Note"}</Text><Text style={{ color: colors.text }}>{block.body}</Text></>;
  if (block.type === "spotlight" || block.type === "shelf" || block.type === "currentlyReading") {
    const selected = block.type === "spotlight" ? books.filter((book) => bookKey(book) === block.bookKey) : block.type === "shelf" ? resolveShelfBooks(block, books) : books.filter((book) => book.ReadStatus === 1);
    return <><Text style={[styles.blockTitle, { color: colors.text }]}>{block.type === "shelf" ? block.title || "Shelf" : block.type === "currentlyReading" ? "Currently reading" : title(selected[0])}</Text>
      {selected.length ? <View style={{ flex: 1, flexDirection: "row", gap: spacing.sm }}>{selected.slice(0, 3).map((book) => <View key={bookKey(book)} style={{ flex: 1, minWidth: 0 }}><View style={{ flex: 1, minHeight: 48 }}><CoverImage book={book} contentFit="contain" /></View><Text numberOfLines={2} style={{ color: colors.text }}>{title(book)}</Text></View>)}</View> : <Text style={{ color: colors.textDim }}>Choose books or connect a collection in Edit.</Text>}
    </>;
  }
  if (block.type === "quote") { const value = resolveQuote(block, books); return <><Text numberOfLines={6} style={{ color: colors.text }}>“{String(value?.highlight.Text ?? "No eligible passage available")}”</Text>{value ? <Text style={{ color: colors.textDim }}>{String(value.book.Title)} · {String(value.book.Attribution ?? "")}</Text> : null}</>; }
  if (block.type === "quoteCollection") return <><Text style={styles.blockTitle}>{block.title || "Quotes"}</Text>{resolveQuoteCollection(block, books).map(({ highlight }, index) => <Text key={index}>“{String(highlight.Text ?? highlight.Annotation ?? "")}”</Text>)}</>;
  if (block.type === "image") { const image = images.find((item) => item.id === block.imageId); return image ? <><Image source={{ uri: image.url }} style={styles.fill} contentFit="cover" />{block.caption ? <Text>{block.caption}</Text> : null}</> : <Text>Image unavailable</Text>; }

  if (block.type === "stats") return <View style={styles.stats}>{block.metrics.map((metric) => <View key={metric}><Text style={styles.stat}>{statsOverride?.[metric] ?? computeStat(metric, books)}</Text><Text>{STAT_METRIC_LABELS[metric]}</Text></View>)}</View>;
  if (block.type === "tierlist") { const tierlist = tierlists.find((item) => item.id === block.tierlistId); return <><Text style={styles.blockTitle}>{tierlist?.name ?? "Tier list unavailable"}</Text>{tierlist?.data.tiers.map((tier) => <Text key={tier.id}>{tier.label}: {tier.bookKeys.length}</Text>)}</>; }
  return <Text>{BLOCK_TYPE_LABELS[block.type]}</Text>;
}

function CanvasBlock({ block, columnWidth, editable, selected, books, images, tierlists, statsOverride, onSelect, onMove }: {
  block: MuralBlock;
  columnWidth: number;
  editable: boolean;
  selected: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  statsOverride?: Record<string, number>;
  onSelect: () => void;
  onMove: (dx: number, dy: number) => void;
}) {
  const { colors } = useTheme();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const lifted = useSharedValue(0);
  // A block gave no sign at all that the long press had armed it — the haptic
  // arrives with a visible lift, never on its own.
  const gesture = Gesture.Pan()
    .enabled(editable)
    .activateAfterLongPress(220)
    .onStart(() => { lifted.value = withSpring(1, LIFT_SPRING); scheduleOnRN(liftHaptic); })
    .onUpdate((event) => { x.value = event.translationX; y.value = event.translationY; })
    .onEnd((event) => {
      const dx = Math.round(event.translationX / columnWidth);
      const dy = Math.round(event.translationY / ROW_HEIGHT);
      scheduleOnRN(onMove, dx, dy);
      if (dx !== 0 || dy !== 0) scheduleOnRN(commitHaptic);
    })
    .onFinalize(() => { x.value = withSpring(0); y.value = withSpring(0); lifted.value = withSpring(0, LIFT_SPRING); });
  const animated = useAnimatedStyle(() => ({
    opacity: 1 - lifted.value * 0.15,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: 1 + lifted.value * 0.03 }],
  }));
  const style = resolveBlockStyle(block.style);
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[
        styles.block,
        {
          left: block.layout.x * columnWidth,
          top: block.layout.y * ROW_HEIGHT,
          width: block.layout.w * columnWidth - GAP,
          height: block.layout.h * ROW_HEIGHT - GAP,
          backgroundColor: style.backgroundColor ?? colors.surface,
          borderColor: selected ? colors.accent : resolveBorderColor(style.cardBorderColor, style.cardBorderOpacity, colors.border),
          borderWidth: selected ? Math.max(2, style.cardBorderWidth) : style.cardBorderWidth,
          borderStyle: resolveBorderStyle(style.cardBorderStyle),
          borderRadius: style.cardRadius,
          opacity: style.cardOpacity / 100,
        },
        animated,
      ]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${BLOCK_TYPE_LABELS[block.type]} block${editable ? ". Long press and drag to move" : ""}`} onPress={onSelect} style={styles.blockPress}>
          <View style={{ flex: 1 }}><BlockContent block={block} books={books} images={images} tierlists={tierlists} statsOverride={statsOverride} /></View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

export function MuralCanvas({ mural, books, images, tierlists, statsOverride, editable = false, selectedBlockId, onSelectBlock, onLayoutChange, groups = [] }: {
  mural: Mural;
  groups?: Group[];
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  statsOverride?: Record<string, number>;
  editable?: boolean;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
  onLayoutChange?: (id: string, layout: BlockLayout) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const columnWidth = width / GRID_COLUMNS;
  const height = muralCanvasHeight(mural.blocks, ROW_HEIGHT);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.canvas, { height, backgroundColor: colors.background }]}>
      {width > 0 ? mural.blocks.map((block) => <CanvasBlock
        key={block.id}
        block={resolveHomeBlock(block, books, groups, day)}
        columnWidth={columnWidth}
        editable={editable}
        selected={block.id === selectedBlockId}
        books={books}
        images={images}
        tierlists={tierlists}
        statsOverride={statsOverride}
        onSelect={() => onSelectBlock?.(block.id)}
        onMove={(dx, dy) => onLayoutChange?.(block.id, { ...block.layout, x: block.layout.x + dx, y: block.layout.y + dy })}
      />) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: "relative", width: "100%" },
  block: { position: "absolute", overflow: "hidden", padding: spacing.sm },
  blockPress: { flex: 1, minHeight: minimumTouchTarget },
  blockTitle: { ...typography.body, fontWeight: "700" },
  pill: { borderWidth: 1, borderRadius: 8, padding: spacing.xs, marginRight: spacing.xs },
  fill: { flex: 1, width: "100%" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  stat: { fontSize: 20, fontWeight: "700" },
});
