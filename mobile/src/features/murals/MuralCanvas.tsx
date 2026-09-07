import { useState } from "react";
import {
  BLOCK_TYPE_LABELS,
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
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { resolveBorderColor, resolveBorderStyle } from "../../ui/libraryStyle";
import { minimumTouchTarget, spacing, typography, useTheme } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import type { Tierlist } from "../tierlists/api";
import { muralCanvasHeight } from "./layout";

const ROW_HEIGHT = 36;
const GAP = 8;

function BlockContent({ block, books, images, tierlists }: { block: MuralBlock; books: Array<Record<string, unknown>>; images: GalleryImage[]; tierlists: Tierlist[] }) {
  const { colors } = useTheme();
  const title = (book: Record<string, unknown> | undefined) => String(book?.Title ?? "Book unavailable");
  if (block.type === "text") return <><Text style={styles.blockTitle}>{block.heading || "Note"}</Text><Text>{block.body}</Text></>;
  if (block.type === "spotlight") { const book = books.find((item) => bookKey(item) === block.bookKey); return <><Text style={styles.blockTitle}>{title(book)}</Text><Text>{String(book?.Attribution ?? "")}</Text>{block.caption ? <Text>{block.caption}</Text> : null}</>; }
  if (block.type === "shelf") return <><Text style={styles.blockTitle}>{block.title || "Shelf"}</Text><ScrollView horizontal>{resolveShelfBooks(block, books).map((book) => <Text key={bookKey(book)} style={[styles.pill, { borderColor: colors.border }]}>{title(book)}</Text>)}</ScrollView></>;
  if (block.type === "quote") { const value = resolveQuote(block, books); return <Text>“{String(value?.highlight.Text ?? value?.highlight.Annotation ?? "Quote unavailable")}”</Text>; }
  if (block.type === "quoteCollection") return <><Text style={styles.blockTitle}>{block.title || "Quotes"}</Text>{resolveQuoteCollection(block, books).map(({ highlight }, index) => <Text key={index}>“{String(highlight.Text ?? highlight.Annotation ?? "")}”</Text>)}</>;
  if (block.type === "image") { const image = images.find((item) => item.id === block.imageId); return image ? <><Image source={{ uri: image.url }} style={styles.fill} contentFit="cover" />{block.caption ? <Text>{block.caption}</Text> : null}</> : <Text>Image unavailable</Text>; }
  if (block.type === "currentlyReading") { const reading = books.filter((book) => book.ReadStatus === 1); return <><Text style={styles.blockTitle}>Currently reading</Text>{reading.map((book) => <Text key={bookKey(book)}>{title(book)}</Text>)}</>; }
  if (block.type === "stats") return <View style={styles.stats}>{block.metrics.map((metric) => <View key={metric}><Text style={styles.stat}>{computeStat(metric, books)}</Text><Text>{STAT_METRIC_LABELS[metric]}</Text></View>)}</View>;
  if (block.type === "tierlist") { const tierlist = tierlists.find((item) => item.id === block.tierlistId); return <><Text style={styles.blockTitle}>{tierlist?.name ?? "Tier list unavailable"}</Text>{tierlist?.data.tiers.map((tier) => <Text key={tier.id}>{tier.label}: {tier.bookKeys.length}</Text>)}</>; }
  return <Text>{BLOCK_TYPE_LABELS[block.type]}</Text>;
}

function CanvasBlock({ block, columnWidth, editable, selected, books, images, tierlists, onSelect, onMove }: {
  block: MuralBlock;
  columnWidth: number;
  editable: boolean;
  selected: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  onSelect: () => void;
  onMove: (dx: number, dy: number) => void;
}) {
  const { colors } = useTheme();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gesture = Gesture.Pan().enabled(editable).activateAfterLongPress(220).onUpdate((event) => { x.value = event.translationX; y.value = event.translationY; }).onEnd((event) => { runOnJS(onMove)(Math.round(event.translationX / columnWidth), Math.round(event.translationY / ROW_HEIGHT)); }).onFinalize(() => { x.value = withSpring(0); y.value = withSpring(0); });
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
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
          <View style={{ flex: 1 }}><BlockContent block={block} books={books} images={images} tierlists={tierlists} /></View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

export function MuralCanvas({ mural, books, images, tierlists, editable = false, selectedBlockId, onSelectBlock, onLayoutChange }: {
  mural: Mural;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  editable?: boolean;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
  onLayoutChange?: (id: string, layout: BlockLayout) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const columnWidth = width / GRID_COLUMNS;
  const height = muralCanvasHeight(mural.blocks, ROW_HEIGHT);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.canvas, { height, backgroundColor: colors.background }]}>
      {width > 0 ? mural.blocks.map((block) => <CanvasBlock
        key={block.id}
        block={block}
        columnWidth={columnWidth}
        editable={editable}
        selected={block.id === selectedBlockId}
        books={books}
        images={images}
        tierlists={tierlists}
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
