import { useState } from "react";
import {
  BLOCK_TYPE_LABELS,
  calculateShelfTheme,
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
  type BlockStyle,
  type Mural,
  type MuralBlock,
  type ReaderProfile,
  type ShelfTheme,
} from "@scripta/shared";
import { CoverImage } from "../library/components/CoverImage";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { commitHaptic, liftHaptic } from "../../ui/haptics";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { blockFontFamily, resolveBorderColor, resolveBorderStyle } from "../../ui/libraryStyle";
import { minimumTouchTarget, spacing, useTheme } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import type { Tierlist } from "../tierlists/api";
import { muralCanvasHeight } from "./layout";

const LIFT_SPRING = { duration: 300, dampingRatio: 0.8 } as const;
const ROW_HEIGHT = 36;
const GAP = 8;

const blockShadow = Platform.select({
  ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4 },
  android: { elevation: 2 },
  default: {},
});

/** Every size inside a block is an `em` of the block's own font size on the
 *  web canvas (1.25em name, 1.1em heading, 0.7em label), and nothing here
 *  read the block's font settings at all — a style panel change moved the
 *  web and left mobile alone. These are the web's own ratios, so both
 *  clients answer the same settings with the same hierarchy. */
function blockTextStyles(style: BlockStyle, color: string) {
  const face = {
    fontFamily: blockFontFamily(style.codeStyle ? "jetbrainsMono" : style.fontFamily),
    fontStyle: style.italic ? ("italic" as const) : ("normal" as const),
    color,
  };
  // Nothing shrinks below 11pt, the floor a phone at arm's length can still
  // read — at the default 14pt block a 0.7em label is 9.8px, fine on a
  // desktop and not here. A block deliberately set smaller than the floor
  // keeps its own size as the ceiling instead of having steps grow past it.
  const floor = Math.min(11, style.fontSize);
  const step = (em: number, weight?: TextStyle["fontWeight"]): TextStyle => {
    const size = Math.max(floor, Math.round(style.fontSize * em));
    return { ...face, fontSize: size, lineHeight: Math.round(size * 1.4), fontWeight: weight ?? (style.bold ? "700" : "400") };
  };
  return {
    name: step(1.25, "700"),
    stat: step(1.45, "700"),
    title: step(1.1, "700"),
    body: step(1),
    bio: step(0.9),
    caption: step(0.85),
    label: step(0.7, "700"),
  };
}

/** Centred rather than dropped at the top edge: a block sized for covers
 *  it hasn't been given yet is mostly empty, and a caption stranded above
 *  200pt of nothing reads as a broken card instead of an unfilled one. */
function EmptyBlock({ message, style }: { message: string; style: StyleProp<TextStyle> }) {
  return <View style={styles.emptyBlock}><Text style={style}>{message}</Text></View>;
}

export function BlockContent({ block, books, images, tierlists, profile, shelfThemeOverride, statsOverride }: { block: MuralBlock; books: Array<Record<string, unknown>>; images: GalleryImage[]; tierlists: Tierlist[]; profile?: ReaderProfile; shelfThemeOverride?: ShelfTheme; statsOverride?: Record<string, number> }) {
  const { colors: themeColors } = useTheme();
  const style = resolveBlockStyle(block.style);
  const colors = { ...themeColors, text: style.textColor ?? themeColors.text };
  const text = blockTextStyles(style, colors.text);
  const dim = { color: colors.textDim };
  const title = (book: Record<string, unknown> | undefined) => String(book?.Title ?? "Book unavailable");
  if (block.type === "text") return <><Text style={text.title}>{block.heading || "Note"}</Text><Text style={text.body}>{block.body}</Text></>;
  if (block.type === "profile") {
    const theme = shelfThemeOverride ?? calculateShelfTheme(books);
    const initial = (profile?.username || "Reader")[0]?.toUpperCase();
    return <View style={styles.profileBlock}>
      <View style={styles.profileHeader}>
        {profile?.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={styles.profileAvatar} contentFit="cover" /> : <View style={[styles.profileAvatar, styles.profileInitial, { backgroundColor: colors.accentSoft }]}><Text style={[styles.profileInitialText, { color: colors.accent }]}>{initial}</Text></View>}
        <View style={styles.profileCopy}><Text numberOfLines={1} style={text.name}>@{profile?.username || "reader"}</Text>{block.bio ? <Text numberOfLines={3} style={[text.bio, dim]}>{block.bio}</Text> : null}</View>
      </View>
      {block.favoriteGenres.length ? <View style={styles.genreSection}><Text style={[text.label, styles.genreLabel, dim]}>What I like</Text><View style={styles.genreRow}>{block.favoriteGenres.map((genre) => <View key={genre} style={[styles.genreChip, { backgroundColor: colors.accentSoft }]}><Text style={[text.caption, { color: colors.accent }]}>{genre}</Text></View>)}</View></View> : null}
      {theme.genres.length ? <View style={styles.genreSection}><Text style={[text.label, styles.genreLabel, dim]}>My shelf theme</Text><Text style={text.body}>{theme.genres.join(" · ")}</Text><Text style={[text.caption, dim]}>Based on {theme.matchedBooks} of {theme.totalBooks} books</Text></View> : null}
    </View>;
  }
  if (block.type === "spotlight" || block.type === "shelf" || block.type === "currentlyReading") {
    const selected = block.type === "spotlight" ? books.filter((book) => bookKey(book) === block.bookKey) : block.type === "shelf" ? resolveShelfBooks(block, books) : books.filter((book) => book.ReadStatus === 1);
    return <><Text numberOfLines={1} style={text.title}>{block.type === "shelf" ? block.title || "Shelf" : block.type === "currentlyReading" ? "Currently reading" : title(selected[0])}</Text>
      {selected.length ? <View style={styles.bookRow}>{selected.slice(0, 3).map((book) => <View key={bookKey(book)} style={styles.bookColumn}><View style={styles.bookCover}><CoverImage book={book} contentFit="contain" /></View><Text numberOfLines={2} style={text.caption}>{title(book)}</Text></View>)}</View> : <EmptyBlock message="Choose books or connect a collection in Edit." style={[text.caption, dim]} />}
    </>;
  }
  if (block.type === "quote") { const value = resolveQuote(block, books); return <><Text numberOfLines={6} style={text.body}>“{String(value?.highlight.Text ?? "No eligible passage available")}”</Text>{value ? <Text style={[text.caption, dim]}>{String(value.book.Title)} · {String(value.book.Attribution ?? "")}</Text> : null}</>; }
  if (block.type === "quoteCollection") return <><Text style={text.title}>{block.title || "Quotes"}</Text>{resolveQuoteCollection(block, books).map(({ highlight }, index) => <Text key={index} style={text.body}>“{String(highlight.Text ?? highlight.Annotation ?? "")}”</Text>)}</>;
  if (block.type === "image") { const image = images.find((item) => item.id === block.imageId); return image ? <><Image source={{ uri: image.url }} style={styles.fill} contentFit="cover" />{block.caption ? <Text style={[text.caption, dim]}>{block.caption}</Text> : null}</> : <EmptyBlock message="Image unavailable" style={[text.caption, dim]} />; }

  if (block.type === "stats") return <View style={styles.stats}>{block.metrics.map((metric) => <View key={metric}><Text style={text.stat}>{statsOverride?.[metric] ?? computeStat(metric, books)}</Text><Text style={[text.caption, dim]}>{STAT_METRIC_LABELS[metric]}</Text></View>)}</View>;
  if (block.type === "tierlist") { const tierlist = tierlists.find((item) => item.id === block.tierlistId); return <><Text numberOfLines={1} style={text.title}>{tierlist?.name ?? "Tier list unavailable"}</Text>{tierlist?.data.tiers.map((tier) => <Text key={tier.id} style={text.body}>{tier.label}: {tier.bookKeys.length}</Text>)}</>; }
  return <Text style={text.body}>{BLOCK_TYPE_LABELS[block.type]}</Text>;
}

function CanvasBlock({ block, columnWidth, editable, selected, books, images, tierlists, profile, shelfThemeOverride, statsOverride, onSelect, onMove }: {
  block: MuralBlock;
  columnWidth: number;
  editable: boolean;
  selected: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  shelfThemeOverride?: ShelfTheme;
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
        style.cardShadow ? blockShadow : null,
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
          <View style={styles.blockBody}><BlockContent block={block} books={books} images={images} tierlists={tierlists} profile={profile} shelfThemeOverride={shelfThemeOverride} statsOverride={statsOverride} /></View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

export function MuralCanvas({ mural, books, images, tierlists, profile, shelfThemeOverride, statsOverride, editable = false, selectedBlockId, onSelectBlock, onLayoutChange, groups = [] }: {
  mural: Mural;
  groups?: Group[];
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  shelfThemeOverride?: ShelfTheme;
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
  const height = muralCanvasHeight(mural.blocks, ROW_HEIGHT, editable ? undefined : 0);
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
        profile={profile}
        shelfThemeOverride={shelfThemeOverride}
        statsOverride={statsOverride}
        onSelect={() => onSelectBlock?.(block.id)}
        onMove={(dx, dy) => onLayoutChange?.(block.id, { ...block.layout, x: block.layout.x + dx, y: block.layout.y + dy })}
      />) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: "relative", width: "100%" },
  block: { position: "absolute", overflow: "hidden", padding: spacing.lg },
  blockPress: { flex: 1, minHeight: minimumTouchTarget },
  blockBody: { flex: 1, gap: spacing.sm },
  emptyBlock: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" },
  bookRow: { flex: 1, flexDirection: "row", gap: spacing.sm },
  bookColumn: { flex: 1, minWidth: 0, gap: spacing.xs },
  bookCover: { flex: 1, minHeight: 48 },
  pill: { borderWidth: 1, borderRadius: 8, padding: spacing.xs, marginRight: spacing.xs },
  fill: { flex: 1, width: "100%" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  profileBlock: { flex: 1, gap: spacing.md },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  profileAvatar: { width: 56, height: 56, borderRadius: 28 },
  profileInitial: { alignItems: "center", justifyContent: "center" },
  profileInitialText: { fontSize: 22, fontWeight: "700" },
  profileCopy: { flex: 1, gap: spacing.xs },
  genreSection: { gap: spacing.xs },
  genreLabel: { textTransform: "uppercase", letterSpacing: 0.8 },
  genreRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  genreChip: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
