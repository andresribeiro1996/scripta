import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  blockBooks,
  blockLabel,
  FINISH_TILE_SIZE,
  blockFinish,
  blockEffects,
  blockGradient,
  blockTextColors,
  calculateShelfTheme,
  finishTileMarkup,
  resolveHomeBlock,
  type Group,
  GRID_COLUMNS,
  bookKey,
  computeStat,
  libraryBreakdown,
  muralThemeId,
  moveMuralBlock,
  muralDragScrollSpeed,
  readingPercent,
  resolveBlockColor,
  resolveBlockStyle,
  resolveQuote,
  resolveQuoteCollection,
  STAT_METRIC_LABELS,
  type BlockLayout,
  type BlockStyle,
  type Mural,
  type MuralBlock,
  type PublicReaderCard,
  type ReaderProfile,
  type ShelfTheme,
  type StatMetric,
} from "@scripta/shared";
import { themes, type ThemeId } from "@scripta/shared/themes";
import { CoverImage } from "../library/components/CoverImage";
import { ReaderCardBlock } from "./ReaderCardBlock";
import { Image } from "expo-image";
import { SvgXml } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { measure, scrollTo, useAnimatedReaction, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withSpring, type AnimatedRef, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { commitHaptic, liftHaptic } from "../../ui/haptics";
import { PixelRatio, Pressable, ScrollView, StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { Text } from "../../ui/Text";
import { blockFontFamily, resolveBorderColor, resolveBorderStyle } from "../../ui/libraryStyle";
import { minimumTouchTarget, MuralThemeScope, radii, spacing, useTheme, type ThemeColors } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import type { Tierlist } from "../tierlists/api";
import { selectionBorderColor } from "./blockStyleOptions";
import { MURAL_ROW_HEIGHT, muralCanvasHeight, muralDragCell, muralDragPosition, muralPreviewScale } from "./layout";

const LIFT_SPRING = { duration: 300, dampingRatio: 0.8 } as const;
const MOVE_SPRING = { duration: 220, dampingRatio: 1, overshootClamping: true } as const;
const ROW_HEIGHT = MURAL_ROW_HEIGHT;
const GAP = 8;
const ROW_GAP = GAP;
const gridColumnWidth = (width: number) => (width + GAP) / GRID_COLUMNS;
type DragState = { id: string; layout: BlockLayout; dx: number; dy: number; pointerY: number; startScroll: number; drop?: BlockLayout };
export type MuralDragScroll = { ref: AnimatedRef<ScrollView>; offset: SharedValue<number>; contentHeight: SharedValue<number>; bottomInset: SharedValue<number> };
const PROGRESS_TRACK = 4;

const BLOCK_PADDING = { tight: spacing.sm, normal: spacing.md, roomy: spacing.xl } as const;

function sideWidths(width: number, sides: BlockStyle["cardBorderSides"]) {
  return {
    borderTopWidth: sides.top ? width : 0,
    borderRightWidth: sides.right ? width : 0,
    borderBottomWidth: sides.bottom ? width : 0,
    borderLeftWidth: sides.left ? width : 0,
  };
}

function blockPadding(style: BlockStyle) {
  return { padding: BLOCK_PADDING[style.innerSpacing] ?? BLOCK_PADDING.normal };
}

function blockFrameStyle(style: BlockStyle, colors: ThemeColors) {
  const effects = blockEffects(style, colors);
  return {
    backgroundColor: resolveBlockColor(style.backgroundColor, colors) ?? colors.surface,
    experimental_backgroundImage: blockGradient(style, colors)?.image,
    borderColor: resolveBorderColor(resolveBlockColor(style.cardBorderColor, colors), style.cardBorderOpacity, colors.border),
    ...sideWidths(style.cardBorderWidth, style.cardBorderSides),
    borderStyle: resolveBorderStyle(style.cardBorderStyle),
    borderRadius: style.cardRadius,
    opacity: effects.opacity,
    boxShadow: effects.boxShadow,
  };
}

function FinishOverlay({ id, style, colors }: { id: string; style: BlockStyle; colors: ThemeColors }) {
  const finish = blockFinish(style, colors);
  if (!finish) return null;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg"><defs><pattern id="finish-${id}" patternUnits="userSpaceOnUse" width="${FINISH_TILE_SIZE}" height="${FINISH_TILE_SIZE}">${finishTileMarkup(finish.finish, finish.ink)}</pattern></defs><rect width="100%" height="100%" fill="url(#finish-${id})"/></svg>`;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}><SvgXml xml={xml} width="100%" height="100%" /></View>;
}

function FadeOverlay({ style, colors }: { style: BlockStyle; colors: ThemeColors }) {
  const effects = blockEffects(style, colors);
  return effects.fadeColor && effects.fadeOpacity > 0 ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { backgroundColor: effects.fadeColor, opacity: effects.fadeOpacity, borderRadius: style.cardRadius }]} /> : null;
}

/** Every size inside a block is an `em` of the block's own font size on the
 *  web canvas (1.25em name, 1.1em heading, 0.7em label), and nothing here
 *  read the block's font settings at all — a style panel change moved the
 *  web and left mobile alone. These are the web's own ratios, so both
 *  clients answer the same settings with the same hierarchy. */
function blockTextStyles(style: BlockStyle, color: string) {
  const face = {
    fontFamily: blockFontFamily(style.codeStyle ? "jetbrainsMono" : style.fontFamily),
    fontStyle: style.italic ? ("italic" as const) : ("normal" as const),
    textAlign: style.textAlign,
    color,
  };
  // Nothing shrinks below 11pt, the floor a phone at arm's length can still
  // read — at the default 14pt block a 0.7em label is 9.8px, fine on a
  // desktop and not here. A block deliberately set smaller than the floor
  // keeps its own size as the ceiling instead of having steps grow past it.
  const floor = Math.min(11, style.fontSize);
  const step = (em: number, weight?: TextStyle["fontWeight"]): TextStyle & { lineHeight: number } => {
    const size = Math.max(floor, Math.round(style.fontSize * em));
    return { ...face, fontSize: size, lineHeight: Math.round(size * 1.4), fontWeight: weight ?? (style.bold ? "700" : "400") };
  };
  return {
    name: step(1.25, "700"),
    hero: step(2.8, "700"),
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

const title = (book: Record<string, unknown> | undefined) => String(book?.Title ?? "Book unavailable");

function CoverRow({ blockId, books, mode, caption, dim, accent, editable, onAssetReady }: { blockId: string; books: Array<Record<string, unknown>>; mode: "reading" | "shelf"; caption: ReturnType<typeof blockTextStyles>["caption"]; dim: { color: string }; accent: string; editable?: boolean; onAssetReady?: (key: string) => void }) {
  const { colors } = useTheme();
  const [rowHeight, setRowHeight] = useState(0);
  const line = Math.ceil(caption.lineHeight * PixelRatio.getFontScale());
  const showProgress = mode === "reading" && books.some((book) => readingPercent(book) !== null);
  const bodyHeight = mode === "shelf" ? line : showProgress ? PROGRESS_TRACK + spacing.xs + line : 0;
  const footerHeight = bodyHeight ? spacing.xs + bodyHeight : 0;
  const coverHeight = Math.max(0, rowHeight - footerHeight);
  const tileWidth = (coverHeight * 2) / 3;
  return <ScrollView horizontal scrollEnabled={!editable} showsHorizontalScrollIndicator={false} onLayout={(event) => setRowHeight(event.nativeEvent.layout.height)} style={styles.coverScroll} contentContainerStyle={styles.coverRow}>{rowHeight > 0 ? books.map((book) => {
    const percent = mode === "reading" ? readingPercent(book) : null;
    return <View key={bookKey(book)} style={[styles.coverTile, { width: tileWidth, height: rowHeight }]}>
      <View accessible accessibilityRole="image" accessibilityLabel={title(book)} style={{ width: tileWidth, height: coverHeight }}><CoverImage book={book} contentFit="contain" onLoadEnd={onAssetReady ? () => onAssetReady(`cover:${blockId}:${bookKey(book)}:${String(book._coverUrl ?? "")}`) : undefined} /></View>
      {bodyHeight ? <View style={[styles.coverFooter, { height: bodyHeight }]}>
        {mode === "shelf" ? <Text numberOfLines={1} style={caption}>{title(book)}</Text> : percent === null ? null : <>
          <View style={[styles.readingTrack, { backgroundColor: colors.border }]}>{percent ? <View style={[styles.readingFill, { width: `${percent}%`, backgroundColor: accent }]} /> : null}</View>
          <Text style={[caption, dim]}>{percent}%</Text>
        </>}
      </View> : null}
    </View>;
  }) : null}</ScrollView>;
}

export function BlockContent({ block, books, images, tierlists, profile, groups, shelfThemeOverride, readerCardOverride, statsOverride, editable, onAssetReady }: { block: MuralBlock; books: Array<Record<string, unknown>>; images: GalleryImage[]; tierlists: Tierlist[]; profile?: ReaderProfile; groups?: Group[]; shelfThemeOverride?: ShelfTheme; readerCardOverride?: PublicReaderCard; statsOverride?: Record<string, number>; editable?: boolean; onAssetReady?: (key: string) => void }) {
  const { colors: themeColors } = useTheme();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const style = resolveBlockStyle(block.style);
  const blockColors = blockTextColors(style, themeColors);
  const colors = { ...themeColors, text: blockColors.text };
  const text = blockTextStyles(style, colors.text);
  const dim = { color: blockColors.dim };
  const eyebrow = (label: string, count?: number) => <View style={styles.eyebrowRow}><Text numberOfLines={1} style={[text.label, styles.genreLabel, dim, styles.eyebrowLabel]}>{label}</Text>{count === undefined ? null : <Text style={[text.caption, dim, styles.eyebrowCount]}>{count} {count === 1 ? "book" : "books"}</Text>}</View>;
  if (block.type === "text") return <><Text numberOfLines={2} style={text.title}>{block.heading || "Note"}</Text><Text style={text.body}>{block.body}</Text></>;
  if (block.type === "profile") {
    const theme = shelfThemeOverride ?? calculateShelfTheme(books);
    const initial = (profile?.username || "Reader")[0]?.toUpperCase();
    return <View style={styles.profileBlock}>
      <View style={styles.profileHeader}>
        {profile?.avatarUrl && failedSource !== profile.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={styles.profileAvatar} contentFit="cover" onDisplay={() => onAssetReady?.(`avatar:${block.id}:${profile.avatarUrl}`)} onError={() => { setFailedSource(profile.avatarUrl!); onAssetReady?.(`avatar:${block.id}:${profile.avatarUrl}`); }} /> : <View style={[styles.profileAvatar, styles.profileInitial, { backgroundColor: colors.accentSoft }]}><Text style={[styles.profileInitialText, { color: colors.accent }]}>{initial}</Text></View>}
        <View style={styles.profileCopy}><Text numberOfLines={1} style={text.name}>@{profile?.username || "reader"}</Text>{block.bio ? <Text numberOfLines={3} style={[text.bio, dim]}>{block.bio}</Text> : null}</View>
      </View>
      {block.favoriteGenres.length ? <View style={styles.genreSection}><Text style={[text.label, styles.genreLabel, dim]}>What I like</Text><View style={styles.genreRow}>{block.favoriteGenres.map((genre) => <View key={genre} style={[styles.genreChip, { backgroundColor: colors.accentSoft }]}><Text style={[text.caption, { color: colors.accent }]}>{genre}</Text></View>)}</View></View> : null}
      {theme.genres.length ? <View style={styles.genreSection}><Text style={[text.label, styles.genreLabel, dim]}>My shelf theme</Text><Text style={text.body}>{theme.genres.join(" · ")}</Text><Text style={[text.caption, dim]}>Based on {theme.matchedBooks} of {theme.totalBooks} books</Text></View> : null}
    </View>;
  }
  if (block.type === "currentlyReading") {
    const reading = blockBooks(block, books);
    return <>{eyebrow("Currently reading", reading.length)}
      {reading.length ? <CoverRow blockId={block.id} books={reading} mode="reading" caption={text.caption} dim={dim} accent={blockColors.accent} editable={editable} onAssetReady={onAssetReady} /> : <EmptyBlock message="Choose books or connect a collection in Edit." style={[text.caption, dim]} />}
    </>;
  }
  if (block.type === "shelf") {
    const selected = blockBooks(block, books);
    return <>{eyebrow(block.title || "Shelf", selected.length)}
      {selected.length ? <CoverRow blockId={block.id} books={selected} mode="shelf" caption={text.caption} dim={dim} accent={blockColors.accent} editable={editable} onAssetReady={onAssetReady} /> : <EmptyBlock message="Choose books or connect a collection in Edit." style={[text.caption, dim]} />}
    </>;
  }
  if (block.type === "spotlight") {
    const [book] = blockBooks(block, books);
    if (!book) return <EmptyBlock message="Pick a book for this spotlight." style={[text.caption, dim]} />;
    return <View style={styles.bookColumn}>
      <View style={styles.bookCover}><CoverImage book={book} contentFit="contain" onLoadEnd={onAssetReady ? () => onAssetReady(`cover:${block.id}:${bookKey(book)}:${String(book._coverUrl ?? "")}`) : undefined} /></View>
      <Text numberOfLines={1} style={text.title}>{title(book)}</Text>
      <Text numberOfLines={1} style={[text.caption, dim]}>{String(book.Attribution ?? "Unknown author")}</Text>
      {block.caption ? <Text style={text.caption}>{block.caption}</Text> : null}
    </View>;
  }
  if (block.type === "quote") { const value = resolveQuote(block, books); return <><Text numberOfLines={6} style={text.body}>“{String(value?.highlight.Text ?? "No eligible passage available")}”</Text>{value ? <Text style={[text.caption, dim]}>{String(value.book.Title)} · {String(value.book.Attribution ?? "")}</Text> : null}</>; }
  if (block.type === "quoteCollection") return <>{eyebrow(block.title || "Quotes")}{resolveQuoteCollection(block, books).map(({ highlight }, index) => <Text key={index} style={text.body}>“{String(highlight.Text ?? highlight.Annotation ?? "")}”</Text>)}</>;
  if (block.type === "image") { const image = images.find((item) => item.id === block.imageId); return image && failedSource !== image.url ? <><Image source={{ uri: image.url }} style={styles.fill} contentFit="cover" onDisplay={() => onAssetReady?.(`image:${block.id}:${image.url}`)} onError={() => { setFailedSource(image.url); onAssetReady?.(`image:${block.id}:${image.url}`); }} />{block.caption ? <Text style={[text.caption, dim]}>{block.caption}</Text> : null}</> : <EmptyBlock message="Image unavailable" style={[text.caption, dim]} />; }

  if (block.type === "stats") {
    const value = (metric: StatMetric) => statsOverride?.[metric] ?? computeStat(metric, books);
    const breakdown = libraryBreakdown(block.metrics, value);
    if (!breakdown) return <View style={styles.stats}>{block.metrics.map((metric) => <View key={metric}><Text numberOfLines={1} style={text.stat}>{value(metric)}</Text><Text numberOfLines={1} style={[text.caption, dim]}>{STAT_METRIC_LABELS[metric]}</Text></View>)}</View>;
    const segments = [
      { label: "finished", count: breakdown.finished, color: blockColors.accent },
      { label: "reading", count: breakdown.reading, color: colors.accentFill },
      { label: "to read", count: breakdown.toRead, color: colors.border },
    ];
    return <View style={styles.statsBreakdown}>
      {eyebrow("Your library")}
      <View style={styles.statsHero}><Text style={[text.hero, { color: blockColors.accent }]}>{breakdown.finished}</Text><Text style={[text.caption, dim, styles.statsOf]}>of {breakdown.total} finished</Text></View>
      <View style={styles.statsBar}>{breakdown.total ? segments.filter((segment) => segment.count).map((segment) => <View key={segment.label} style={{ flex: segment.count, backgroundColor: segment.color }} />) : <View style={{ flex: 1, backgroundColor: colors.border }} />}</View>
      <View style={styles.statsLegend}>{segments.map((segment) => <View key={segment.label} style={styles.statsLegendRow}><View style={[styles.statsDot, { backgroundColor: segment.color }]} /><Text numberOfLines={1} style={[text.caption, dim]}>{segment.count} {segment.label}</Text></View>)}</View>
      {breakdown.others.map((metric) => <View key={metric} style={styles.statsRow}><Text numberOfLines={1} style={[text.stat, { color: blockColors.accent }]}>{value(metric)}</Text><Text numberOfLines={1} style={[text.caption, dim, styles.statsOf]}>{STAT_METRIC_LABELS[metric]}</Text></View>)}
    </View>;
  }
  if (block.type === "tierlist") { const tierlist = tierlists.find((item) => item.id === block.tierlistId); return <>{eyebrow(tierlist?.name ?? "Tier list unavailable")}{tierlist?.data.tiers.map((tier) => <Text key={tier.id} style={text.body}>{tier.label}: {tier.workIds.length}</Text>)}</>; }
  if (block.type === "readerCard") return <ReaderCardBlock books={books} groups={groups ?? []} readerName={profile?.username || "reader"} publicCard={readerCardOverride} editable={editable} />;
  return <Text style={text.body}>{blockLabel(block.type)}</Text>;
}

const MOVES: Record<string, [number, number]> = { moveLeft: [-1, 0], moveRight: [1, 0], moveUp: [0, -1], moveDown: [0, 1] };
const MOVE_ACTIONS = [
  { name: "moveLeft", label: "Move left" },
  { name: "moveRight", label: "Move right" },
  { name: "moveUp", label: "Move up" },
  { name: "moveDown", label: "Move down" },
];

const CanvasBlock = memo(function CanvasBlock({ block, columnWidth, editable, selected, books, images, tierlists, profile, groups, shelfThemeOverride, readerCardOverride, statsOverride, onSelect, onMove, onAssetReady, drag, preview, drop, scroll }: {
  block: MuralBlock;
  columnWidth: number;
  editable: boolean;
  selected: boolean;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  groups?: Group[];
  shelfThemeOverride?: ShelfTheme;
  readerCardOverride?: PublicReaderCard;
  statsOverride?: Record<string, number>;
  onSelect: () => void;
  onMove: (dx: number, dy: number) => void;
  onAssetReady?: (key: string) => void;
  drag: SharedValue<DragState | null>;
  preview: SharedValue<Record<string, BlockLayout>>;
  drop: SharedValue<BlockLayout | null>;
  scroll?: MuralDragScroll;
}) {
  const { colors } = useTheme();
  const lifted = useSharedValue(0);
  const pointerOrigin = useSharedValue({ x: 0, y: 0, scroll: 0 });
  const reducedMotion = useReducedMotion();
  const callbacks = useRef({ onSelect, onMove });
  useLayoutEffect(() => { callbacks.current = { onSelect, onMove }; }, [onSelect, onMove]);
  const select = useCallback(() => callbacks.current.onSelect(), []);
  const move = useCallback((dx: number, dy: number) => callbacks.current.onMove(dx, dy), []);
  const x = useSharedValue(block.layout.x * columnWidth);
  const y = useSharedValue(block.layout.y * ROW_HEIGHT);
  const scrollOffset = scroll?.offset;
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(editable)
    .activateAfterLongPress(220)
    .onBegin((event) => { pointerOrigin.set({ x: event.absoluteX, y: event.absoluteY, scroll: scrollOffset?.get() ?? 0 }); })
    .onStart((event) => {
      const pointer = pointerOrigin.get();
      const origin = { ...pointer, x: pointer.x - (x.get() - block.layout.x * columnWidth), y: pointer.y - (y.get() - block.layout.y * ROW_HEIGHT) };
      pointerOrigin.set(origin);
      drag.set({ id: block.id, layout: block.layout, dx: event.absoluteX - origin.x, dy: event.absoluteY - origin.y, pointerY: event.absoluteY, startScroll: origin.scroll });
      lifted.set(withSpring(1, LIFT_SPRING));
      scheduleOnRN(select);
      scheduleOnRN(liftHaptic);
    })
    .onUpdate((event) => {
      const current = drag.get();
      const origin = pointerOrigin.get();
      if (current?.id === block.id) drag.set({ ...current, dx: event.absoluteX - origin.x, dy: event.absoluteY - origin.y, pointerY: event.absoluteY });
    })
    .onEnd((event) => {
      const current = drag.get();
      if (current?.id !== block.id) return;
      const origin = pointerOrigin.get();
      const target = drop.get() ?? current.layout;
      const dx = Math.max(0, Math.min(GRID_COLUMNS - current.layout.w, muralDragCell(current.layout.x + (event.absoluteX - origin.x) / columnWidth, target.x))) - current.layout.x;
      const dy = Math.max(0, muralDragCell(current.layout.y + (event.absoluteY - origin.y + (scrollOffset?.get() ?? 0) - current.startScroll) / ROW_HEIGHT, target.y)) - current.layout.y;
      if (dx !== 0 || dy !== 0) {
        drag.set({ ...current, drop: { ...current.layout, x: current.layout.x + dx, y: current.layout.y + dy } });
        scheduleOnRN(move, dx, dy);
        scheduleOnRN(commitHaptic);
      } else drag.set(null);
    })
    .onFinalize((_event, success) => { if (!success && drag.get()?.id === block.id) drag.set(null); lifted.set(withSpring(0, LIFT_SPRING)); }), [editable, block.id, block.layout, columnWidth, drag, drop, lifted, pointerOrigin, scrollOffset, select, move, x, y]);
  useAnimatedReaction(() => {
    const current = drag.get();
    const active = current?.id === block.id && !current.drop;
    const layout = preview.get()[block.id] ?? block.layout;
    const position = active ? muralDragPosition(current.layout, current.dx, current.dy + (scrollOffset?.get() ?? 0) - current.startScroll, columnWidth) : { x: layout.x * columnWidth, y: layout.y * ROW_HEIGHT };
    return { active, ...position };
  }, (next, previous) => {
    if (next.x !== previous?.x || next.active !== previous?.active) x.set(next.active || reducedMotion ? next.x : withSpring(next.x, MOVE_SPRING));
    if (next.y !== previous?.y || next.active !== previous?.active) y.set(next.active || reducedMotion ? next.y : withSpring(next.y, MOVE_SPRING));
  });
  const style = resolveBlockStyle(block.style);
  const restOpacity = blockEffects(style, colors).opacity;
  const animated = useAnimatedStyle(() => {
    const current = drag.get();
    const active = current?.id === block.id;
    return {
      zIndex: active ? 10 : 0,
      opacity: restOpacity * (1 - lifted.get() * 0.25),
      transform: [{ translateX: x.get() }, { translateY: y.get() }],
    };
  });
  const body = <View pointerEvents={editable ? "none" : "auto"} style={styles.blockBody}><BlockContent block={block} books={books} images={images} tierlists={tierlists} profile={profile} groups={groups} shelfThemeOverride={shelfThemeOverride} readerCardOverride={readerCardOverride} statsOverride={statsOverride} editable={editable} onAssetReady={onAssetReady} /></View>;
  const content = <Animated.View renderToHardwareTextureAndroid={editable && selected} shouldRasterizeIOS={editable && selected} style={[
        styles.block,
        blockFrameStyle(style, colors),
        {
          left: 0,
          top: 0,
          width: block.layout.w * columnWidth - GAP,
          height: block.layout.h * ROW_HEIGHT - ROW_GAP,
        },
        animated,
      ]}>
        <FinishOverlay id={block.id} style={style} colors={colors} />
        {editable ? <Pressable accessibilityRole="button" accessibilityLabel={`${blockLabel(block.type)} block. Long press and drag to move`} accessibilityActions={MOVE_ACTIONS} onAccessibilityAction={(event) => { const move = MOVES[event.nativeEvent.actionName]; if (move) onMove(move[0], move[1]); }} onPress={onSelect} style={[styles.blockPress, blockPadding(style)]}>{body}</Pressable> : <View style={[styles.blockPress, blockPadding(style)]}>{body}</View>}
        <FadeOverlay style={style} colors={colors} />
        {selected ? <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderWidth: 2, borderRadius: style.cardRadius, borderColor: selectionBorderColor(style, colors) }} /> : null}
      </Animated.View>;
  return editable ? <GestureDetector gesture={gesture}>{content}</GestureDetector> : content;
});

export function BlockPreview({ theme, block, canvasWidth, maxHeight, books, images, tierlists, profile, groups = [] }: {
  theme: ThemeId;
  block: MuralBlock;
  canvasWidth: number;
  maxHeight: number;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  groups?: Group[];
}) {
  const colors = themes[theme].colors;
  const [boxWidth, setBoxWidth] = useState(0);
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const resolved = useMemo(() => resolveHomeBlock(block, books, groups, day), [block, books, groups, day]);
  const style = resolveBlockStyle(resolved.style);
  const width = block.layout.w * gridColumnWidth(canvasWidth) - GAP;
  const height = block.layout.h * ROW_HEIGHT - ROW_GAP;
  const room = boxWidth - spacing.md * 2;
  const scale = room > 0 && canvasWidth > 0 ? Math.min(1, room / width, maxHeight / height) : 0;
  return (
    <MuralThemeScope theme={theme}>
    <View
      accessibilityLabel={`Preview of this ${blockLabel(block.type)} block`}
      onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}
      style={[styles.previewBox, { height: (scale ? height * scale : maxHeight) + spacing.md * 2, backgroundColor: colors.background }]}
    >
      {scale ? (
        <View style={[styles.previewBlock, blockFrameStyle(style, colors), { width, height, transform: [{ scale }] }]}>
          <FinishOverlay id={block.id} style={style} colors={colors} />
          <View style={[styles.blockPress, blockPadding(style)]}>
            <View style={styles.blockBody}>
              <BlockContent block={resolved} books={books} images={images} tierlists={tierlists} profile={profile} groups={groups} editable />
            </View>
          </View>
          <FadeOverlay style={style} colors={colors} />
        </View>
      ) : null}
    </View>
    </MuralThemeScope>
  );
}

export function MuralCanvas({ mural, books, images, tierlists, profile, shelfThemeOverride, readerCardOverride, statsOverride, editable = false, selectedBlockId, onSelectBlock, onLayoutChange, onImageReadyChange, onDragChange, groups = [], dragScroll }: {
  mural: Mural;
  groups?: Group[];
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  shelfThemeOverride?: ShelfTheme;
  readerCardOverride?: PublicReaderCard;
  statsOverride?: Record<string, number>;
  editable?: boolean;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string | null) => void;
  onLayoutChange?: (id: string, layout: BlockLayout) => void;
  onImageReadyChange?: (ready: boolean) => void;
  onDragChange?: (dragging: boolean) => void;
  dragScroll?: MuralDragScroll;
}) {
  const theme = muralThemeId(mural.theme);
  const colors = themes[theme].colors;
  const [width, setWidth] = useState(0);
  const drag = useSharedValue<DragState | null>(null);
  const preview = useSharedValue<Record<string, BlockLayout>>({});
  const drop = useSharedValue<BlockLayout | null>(null);
  const scrollSpeed = useSharedValue(0);
  const columnWidth = gridColumnWidth(width);
  useAnimatedReaction(() => {
    const current = drag.get();
    return Boolean(current && !current.drop);
  }, (active, previous) => {
    if (active !== previous && onDragChange) scheduleOnRN(onDragChange, active);
  });
  useAnimatedReaction(() => {
    const current = drag.get();
    if (!current || width <= 0) return null;
    const x = current.layout.x + current.dx / columnWidth;
    const y = current.layout.y + (current.dy + (dragScroll?.offset.get() ?? 0) - current.startScroll) / ROW_HEIGHT;
    return { id: current.id, layout: current.drop ?? { ...current.layout, x, y } };
  }, (candidate, previous) => {
    const last = candidate?.id === previous?.id ? drop.get() : null;
    const next = candidate ? { ...candidate, layout: { ...candidate.layout,
      x: Math.max(0, Math.min(GRID_COLUMNS - candidate.layout.w, muralDragCell(candidate.layout.x, last?.x ?? Math.round(candidate.layout.x)))),
      y: Math.max(0, muralDragCell(candidate.layout.y, last?.y ?? Math.round(candidate.layout.y))),
    } } : null;
    if (next?.id === previous?.id && next?.layout.x === last?.x && next?.layout.y === last?.y) return;
    const blocks = next ? moveMuralBlock(mural.blocks, next.id, next.layout) : mural.blocks;
    preview.set(next ? Object.fromEntries(blocks.map((block) => [block.id, block.layout])) : {});
    drop.set(next?.layout ?? null);
  });
  useAnimatedReaction(() => {
    const current = drag.get();
    const saved = current?.drop ? mural.blocks.find((block) => block.id === current.id)?.layout : null;
    const target = current ? preview.get()[current.id] : null;
    return Boolean(saved && current?.drop && target && saved.x === target.x && saved.y === target.y && saved.w === target.w && saved.h === target.h);
  }, (settled) => {
    if (settled) drag.set(null);
  });
  useFrameCallback((frame) => {
    const current = drag.get();
    if (!current || current.drop || !dragScroll) { scrollSpeed.set(0); return; }
    const viewport = measure(dragScroll.ref);
    if (!viewport) return;
    const targetSpeed = muralDragScrollSpeed(current.pointerY, viewport.pageY, viewport.pageY + viewport.height - dragScroll.bottomInset.get());
    const elapsed = Math.min(frame.timeSincePreviousFrame ?? 16, 32);
    const speed = scrollSpeed.get() + (targetSpeed - scrollSpeed.get()) * Math.min(1, elapsed / 100);
    scrollSpeed.set(speed);
    if (Math.abs(speed) < 1) return;
    const offset = dragScroll.offset.get();
    const next = Math.max(0, Math.min(dragScroll.contentHeight.get() - viewport.height, offset + speed * elapsed / 1000));
    if (next !== offset) scrollTo(dragScroll.ref, 0, next, false);
  }, editable);
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const [readyAssets, setReadyAssets] = useState<Set<string>>(() => new Set());
  const onAssetReady = useCallback((key: string) => setReadyAssets((current) => current.has(key) ? current : new Set(current).add(key)), []);
  const resolvedBlocks = useMemo(() => mural.blocks.map((block) => resolveHomeBlock(block, books, groups, day)), [mural.blocks, books, groups, day]);
  const assetKeys = resolvedBlocks.flatMap((block) => {
    if (block.type === "profile" && profile?.avatarUrl) return [`avatar:${block.id}:${profile.avatarUrl}`];
    if (block.type === "image") { const image = images.find((item) => item.id === block.imageId); return image ? [`image:${block.id}:${image.url}`] : []; }
    if (block.type !== "spotlight" && block.type !== "shelf" && block.type !== "currentlyReading") return [];
    const selected = blockBooks(block, books);
    return (block.type === "spotlight" ? selected.slice(0, 3) : selected).map((book) => `cover:${block.id}:${bookKey(book)}:${String(book._coverUrl ?? "")}`);
  });
  const imageReady = width > 0 && assetKeys.every((key) => readyAssets.has(key));
  useEffect(() => { onImageReadyChange?.(imageReady); }, [imageReady, onImageReadyChange]);
  const height = muralCanvasHeight(mural.blocks, ROW_HEIGHT, !editable && mural.blocks.length ? 0 : undefined) + (editable ? ROW_HEIGHT * 6 : 0);
  const canvasStyle = useAnimatedStyle(() => {
    const current = drag.get();
    const movingBottom = current && !current.drop ? (current.layout.y + current.layout.h + 6) * ROW_HEIGHT + current.dy + (dragScroll?.offset.get() ?? 0) - current.startScroll : 0;
    return { height: Math.max(height, Math.ceil(movingBottom / ROW_HEIGHT) * ROW_HEIGHT, ...Object.values(preview.get()).map((layout) => (layout.y + layout.h + 6) * ROW_HEIGHT)) };
  });
  const canvas = (
    <Animated.View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.canvas, { backgroundColor: colors.background }, canvasStyle]}>
      {width > 0 ? resolvedBlocks.map((block) => <CanvasBlock
        key={block.id}
        block={block}
        columnWidth={columnWidth}
        editable={editable}
        selected={block.id === selectedBlockId}
        books={books}
        images={images}
        tierlists={tierlists}
        profile={profile}
        groups={groups}
        shelfThemeOverride={shelfThemeOverride}
        readerCardOverride={readerCardOverride}
        statsOverride={statsOverride}
        onSelect={() => onSelectBlock?.(block.id)}
        onMove={(dx, dy) => {
          const original = mural.blocks.find((item) => item.id === block.id)!;
          onLayoutChange?.(block.id, { ...original.layout, x: original.layout.x + dx, y: original.layout.y + dy });
        }}
        onAssetReady={onImageReadyChange ? onAssetReady : undefined}
        drag={drag}
        preview={preview}
        drop={drop}
        scroll={dragScroll}
      />) : null}
    </Animated.View>
  );
  return <MuralThemeScope theme={theme}>{editable ? <Pressable accessible={false} onPress={() => onSelectBlock?.(null)}>{canvas}</Pressable> : canvas}</MuralThemeScope>;
}

export function MuralThumbnail({ canvasWidth, ...props }: ComponentProps<typeof MuralCanvas> & { canvasWidth: number }) {
  const [width, setWidth] = useState(0);
  const scale = muralPreviewScale(width, canvasWidth);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)} style={styles.thumbnail}>
    {scale > 0 ? <View style={{ position: "absolute", width: canvasWidth, left: 0, top: 0, transformOrigin: "top left", transform: [{ scale }] }}><MuralCanvas {...props} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  thumbnail: { width: "100%", height: "100%", overflow: "hidden" },
  canvas: { position: "relative", width: "100%", overflow: "hidden" },
  block: { position: "absolute", overflow: "hidden" },
  blockPress: { flex: 1, minHeight: minimumTouchTarget },
  blockBody: { flex: 1, gap: spacing.sm },
  previewBox: { borderRadius: radii.lg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  previewBlock: { overflow: "hidden" },
  emptyBlock: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center" },
  bookColumn: { flex: 1, minWidth: 0, gap: spacing.xs },
  bookCover: { flex: 1, minHeight: 48 },
  eyebrowRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  eyebrowLabel: { flexShrink: 1 },
  eyebrowCount: { fontWeight: "400" },
  coverScroll: { flex: 1 },
  coverRow: { gap: spacing.sm },
  coverTile: { gap: spacing.xs },
  coverFooter: { gap: spacing.xs, overflow: "hidden" },
  readingTrack: { height: PROGRESS_TRACK, borderRadius: 999, overflow: "hidden" },
  readingFill: { height: PROGRESS_TRACK },
  pill: { borderWidth: 1, borderRadius: 8, padding: spacing.xs, marginRight: spacing.xs },
  fill: { flex: 1, width: "100%" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statsBreakdown: { flex: 1, gap: spacing.sm },
  statsHero: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  statsOf: { flexShrink: 1 },
  statsBar: { flexDirection: "row", height: 10, gap: 2, borderRadius: 999, overflow: "hidden" },
  statsLegend: { gap: spacing.xs },
  statsLegendRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statsDot: { width: 8, height: 8, borderRadius: 4 },
  statsRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
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
