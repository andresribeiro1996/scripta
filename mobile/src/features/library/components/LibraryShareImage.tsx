import { memo, useCallback, useEffect, useState, type ReactElement } from "react";
import { bookKey, calculateShelfTheme, effectiveCardStyle, plural, statusCounts, type Group, type LibraryBook, type LibraryStyleSettings, type PerCardStyle } from "@scripta/shared";
import { useWindowDimensions, View } from "react-native";
import { Text } from "../../../ui/Text";
import { radii, spacing, typography, useTheme } from "../../../ui";
import { TierCover } from "../../tierlists/TierBoard";
import { libraryGridColumns } from "../lib/gridColumns";
import { newestFinished, readingNow, summaryCoverBooks, wallColumns, type LibraryShareLayout } from "../lib/libraryShareBooks";
import { BookCard } from "./BookCard";

const WALL_GAP = 2;
const FAN_ROTATIONS = ["-10deg", "-3deg", "4deg", "11deg"] as const;
const FAN_COVER = { width: 84, height: 126 };

function coverKey(section: string, book: LibraryBook, index: number) {
  return `${section}:${index}:${String(book.ContentID ?? "")}:${String(book._coverUrl ?? "")}`;
}

const ShareCover = memo(function ShareCover({ book, id, width, height, marginLeft, zIndex, rotate, onLoaded }: {
  book: LibraryBook;
  id: string;
  width: number;
  height: number;
  marginLeft?: number;
  zIndex?: number;
  rotate?: string;
  onLoaded: (key: string) => void;
}) {
  return <TierCover book={book} style={{ width, height, marginLeft, zIndex, transform: rotate ? [{ rotate }] : undefined }} onLoadEnd={() => onLoaded(id)} />;
});

const ShareShelfCard = memo(function ShareShelfCard({ book, id, width, style, seriesStyle, onLoaded }: {
  book: LibraryBook;
  id: string;
  width: number;
  style: LibraryStyleSettings;
  seriesStyle: Partial<PerCardStyle> | undefined;
  onLoaded: (key: string) => void;
}) {
  return <View style={{ width }}>
    <BookCard book={book} style={effectiveCardStyle(style, seriesStyle, book._style as PerCardStyle | undefined)} onPress={() => {}} onLoadEnd={() => onLoaded(id)} />
  </View>;
});

export function LibraryShareImage({ layout, name, ordered, shelf, style, seriesGroups, onReadyChange }: {
  layout: LibraryShareLayout;
  name: string;
  ordered: LibraryBook[];
  shelf: { label: string; query: string; books: LibraryBook[] } | null;
  style: LibraryStyleSettings;
  seriesGroups: Map<string, Group>;
  onReadyChange: (ready: boolean) => void;
}): ReactElement {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());

  const fan = layout === "summary" ? summaryCoverBooks(ordered) : [];
  const reading = layout === "reading" ? readingNow(ordered) : [];
  const finished = layout === "reading" ? newestFinished(ordered, 5) : [];
  const wall = layout === "wall" ? ordered : [];
  const shelfBooks = layout === "shelf" && shelf ? shelf.books : [];
  const expected = [
    ...wall.map((book, index) => coverKey("wall", book, index)),
    ...fan.map((book, index) => coverKey("fan", book, index)),
    ...reading.map((book, index) => coverKey("reading", book, index)),
    ...finished.map((book, index) => coverKey("finished", book, index)),
    ...shelfBooks.map((book, index) => coverKey("shelf", book, index)),
  ];
  const needsCover = layout === "wall" || layout === "shelf";
  const renderable = layout !== "shelf" || shelf !== null;
  useEffect(() => {
    onReadyChange(renderable && (!needsCover || expected.length > 0) && expected.every((key) => loaded.has(key)));
  }, [loaded, onReadyChange, renderable, needsCover, expected.join("|")]);

  const markLoaded = useCallback((key: string) => setLoaded((current) => current.has(key) ? current : new Set(current).add(key)), []);

  function covers(section: string, books: LibraryBook[], perRow: number, gap: number) {
    if (width <= 0) return null;
    const cell = Math.floor((width - gap * (perRow - 1)) / perRow);
    return <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
      {books.map((book, index) => {
        const key = coverKey(section, book, index);
        return <ShareCover key={key} id={key} book={book} width={cell} height={Math.round(cell * 1.5)} onLoaded={markLoaded} />;
      })}
    </View>;
  }

  function sectionLabel(label: string) {
    return <Text style={[typography.caption, { color: colors.textDim }]}>{label}</Text>;
  }

  function stat(value: number, label: string, tint: string) {
    return <View key={label} style={{ flex: 1, padding: spacing.md, borderRadius: radii.lg, backgroundColor: tint, gap: spacing.xs }}>
      <Text display={false} style={[typography.heading, { color: colors.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{value}</Text>
      <Text style={[typography.caption, { color: colors.textDim }]}>{label}</Text>
    </View>;
  }

  function shelfGrid() {
    if (!shelf) return null;
    if (!shelf.books.length) return sectionLabel("This shelf is empty.");
    if (width <= 0) return null;
    const contentWidth = width - 2 * style.contentPaddingX;
    const columns = libraryGridColumns(windowWidth, contentWidth, style);
    const cellWidth = Math.floor((contentWidth - style.cardGap * (columns - 1)) / columns);
    return <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: style.cardGap, rowGap: style.rowGap, paddingHorizontal: style.contentPaddingX, paddingVertical: style.contentPaddingY, backgroundColor: style.backgroundColor ?? undefined }}>
      {shelf.books.map((book, index) => {
        const key = coverKey("shelf", book, index);
        return <ShareShelfCard key={key} id={key} book={book} width={cellWidth} style={style} seriesStyle={seriesGroups.get(bookKey(book))?.style} onLoaded={markLoaded} />;
      })}
    </View>;
  }

  function body() {
    if (layout === "wall") return wall.length ? covers("wall", wall, wallColumns(wall.length), WALL_GAP) : sectionLabel("Your library is empty.");
    if (layout === "summary") {
      const genres = calculateShelfTheme(ordered, 3).genres;
      const counts = statusCounts(ordered);
      return <>
        <View style={{ flexDirection: "row", justifyContent: "center", paddingVertical: spacing.md }}>
          {fan.map((book, index) => {
            const key = coverKey("fan", book, index);
            return <ShareCover key={key} id={key} book={book} {...FAN_COVER} marginLeft={index === 0 ? 0 : -28} zIndex={index} rotate={FAN_ROTATIONS[index] ?? "0deg"} onLoaded={markLoaded} />;
          })}
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {stat(counts.all, "books", colors.accentSoft)}
          {stat(counts.finished, "finished", colors.surface)}
          {stat(counts.reading, "reading", colors.surface)}
        </View>
        {genres.length ? <View style={{ gap: spacing.sm }}>
          {sectionLabel("Top genres")}
          {genres.map((genre, index) => <View key={genre} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface }}>
            <Text style={[typography.title, { color: colors.accent, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{index + 1}</Text>
            <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{genre}</Text>
          </View>)}
        </View> : null}
      </>;
    }
    if (layout === "reading") {
      if (!reading.length && !finished.length) return sectionLabel("Nothing being read or finished yet.");
      return <>
        {reading.length ? <View style={{ gap: spacing.sm }}>{sectionLabel("Reading now")}{covers("reading", reading, 4, spacing.sm)}</View> : null}
        {finished.length ? <View style={{ gap: spacing.sm }}>{sectionLabel("Recently finished")}{covers("finished", finished, 5, spacing.sm)}</View> : null}
      </>;
    }
    return shelfGrid();
  }

  const subtitle = layout === "wall" ? plural(ordered.length, "book", "books")
    : layout === "shelf" && shelf ? [shelf.label, shelf.query.trim() ? `“${shelf.query.trim()}”` : "", plural(shelf.books.length, "book", "books")].filter(Boolean).join(" · ")
    : null;

  return <View style={{ width: "100%", padding: spacing.md, gap: spacing.md, backgroundColor: colors.background }}>
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.title, { color: colors.text, fontWeight: "600" }]}>{name}</Text>
      {subtitle ? <Text style={[typography.caption, { color: colors.textDim }]}>{subtitle}</Text> : null}
    </View>
    <View style={{ gap: spacing.md }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>{renderable ? body() : null}</View>
    <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.md }}>
      <Text style={[typography.caption, { color: colors.textDim, textAlign: "right" }]}>Created with: <Text style={{ color: colors.text, fontWeight: "600" }}>Atmyshelf</Text></Text>
    </View>
  </View>;
}
