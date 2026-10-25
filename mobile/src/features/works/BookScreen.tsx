import { useEffect, useState } from "react";
import { router, useSegments } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { bookStatsModel, coverWash, editionLabel, seriesLabel, type BookScreenModel, type BookScreenTabKey, type WorkPage } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, ConfirmDialog, Icon, Menu, captionHitSlop, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme, type IconName, type MenuItem } from "../../ui";
import { useLibraryActions } from "../library/hooks/useLibraryActions";
import { useChangeStatus } from "../library/hooks/useChangeStatus";
import { BookCover } from "../arena/BookCover";
import { CoverImage } from "../library/components/CoverImage";
import { EditionStrip } from "./EditionStrip";
import { fetchWorkStats } from "./api";
import { StatsTiles } from "./BookStats";
import { RatingStars } from "./RatingStars";
import { bookToolPath, seriesSearchHref, seriesSearchMethod, workStatsPath } from "./workPath";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";

const WASH_HEIGHT = 420;
const WASH_MID_OFFSET = 0.45;
const WASH_MID_FACTOR = 0.5;

export function washAlphaAt(topAlpha: number, y: number): number {
  "worklet";
  const midY = WASH_MID_OFFSET * WASH_HEIGHT;
  const midAlpha = topAlpha * WASH_MID_FACTOR;
  if (y <= 0) return topAlpha;
  if (y < midY) return topAlpha + ((midAlpha - topAlpha) * y) / midY;
  if (y < WASH_HEIGHT) return midAlpha * (1 - (y - midY) / (WASH_HEIGHT - midY));
  return 0;
}

function WashGradient({ color, topAlpha, width }: { color: string; topAlpha: number; width: number }) {
  return (
    <Svg pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={styles.wash} width={width} height={WASH_HEIGHT}>
      <Defs>
        <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={topAlpha} />
          <Stop offset={WASH_MID_OFFSET} stopColor={color} stopOpacity={topAlpha * WASH_MID_FACTOR} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height={WASH_HEIGHT} fill="url(#wash)" />
    </Svg>
  );
}

export function WashBackdrop({ color, topAlpha, scrollY, headerHeight }: { color: string; topAlpha: number; scrollY: SharedValue<number>; headerHeight: number }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const band = useAnimatedStyle(() => ({ opacity: washAlphaAt(topAlpha, scrollY.get()) }));
  const wash = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(scrollY.get(), 0) }] }));
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <View style={[styles.backdropBand, { height: headerHeight, backgroundColor: colors.background }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color }, band]} />
      </View>
      <View style={[styles.backdropWash, { top: headerHeight }]}>
        <Animated.View style={[styles.washLayer, { width, height: WASH_HEIGHT }, wash]}>
          <WashGradient color={color} topAlpha={topAlpha} width={width} />
        </Animated.View>
      </View>
    </View>
  );
}

const TAB_ICONS: Record<BookScreenTabKey, IconName> = { about: "info", highlights: "quote", community: "community" };

export function bookMenuItems(model: BookScreenModel, key: string, segments: readonly string[]): MenuItem[] {
  const to = (tool: "style" | "cover") => () => router.push(bookToolPath(key, tool, segments) as never);
  return model.menu.flatMap((item) => (item === "style" ? [{ label: "Card style", onPress: to("style") }] : item === "cover" ? [{ label: "Change cover", onPress: to("cover") }] : []));
}

function OwnerRow({ book, model }: { book: Record<string, unknown>; model: BookScreenModel }) {
  const { colors } = useTheme();
  const { setRating } = useLibraryActions();
  const changeStatus = useChangeStatus();
  const [rowWidth, setRowWidth] = useState(0);

  const { status, feeling } = model;
  if (!status) return null;
  const width = feeling ? (rowWidth - spacing.sm) / 2 : rowWidth;
  return (
    <View style={styles.primaryRow} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      {rowWidth > 0 ? (
        <>
          <Menu key={`status-${width}`} title="Reading status" items={status.options.map((o) => ({ label: o.label, selected: o.selected, onPress: o.selected ? () => {} : () => void changeStatus(book, o.value) }))}>
            <View style={[styles.menuButton, { width, borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
              <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.centeredText, { color: colors.accent }]}>{status.label} ▾</Text>
            </View>
          </Menu>
          {feeling ? (
            <Menu key={`feeling-${width}`} title="How it landed" items={feeling.options.map((o) => ({ label: o.label, selected: o.selected, onPress: o.selected ? () => {} : () => void setRating(book, o.rating) }))}>
              <View style={[styles.menuButton, { width, borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.centeredText, { color: colors.text }]}>{feeling.label} ▾</Text>
              </View>
            </Menu>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function SeriesLine({ series, signedIn, segments }: { series: NonNullable<BookScreenModel["series"]>; signedIn: boolean; segments: readonly string[] }) {
  const { colors } = useTheme();
  const label = seriesLabel(series);
  const method = signedIn ? seriesSearchMethod(segments) : null;
  if (!method) return <Text {...dynamicType} style={[typography.caption, styles.centeredText, { color: colors.textDim }]}>{label}</Text>;
  return (
    <Pressable accessibilityRole="link" hitSlop={captionHitSlop} onPress={() => router[method](seriesSearchHref(series.name, Date.now(), method) as never)} style={styles.stretch}>
      <Text {...dynamicType} style={[typography.caption, styles.centeredText, { color: colors.text, textDecorationLine: "underline", textDecorationColor: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

function DeleteNote({ book, bookmarkId }: { book: Record<string, unknown>; bookmarkId: string }) {
  const { colors } = useTheme();
  const { deleteNote } = useLibraryActions();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Text accessibilityRole="button" {...dynamicType} onPress={() => setConfirming(true)} style={[typography.caption, styles.strong, { color: colors.danger }]}>
        Delete
      </Text>
      <ConfirmDialog
        visible={confirming}
        title="Delete this note?"
        body="This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirming(false);
          void deleteNote(book, bookmarkId);
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export function BookScreen({ page, book, model, signedIn, onAdd, onSelectEdition, scrollY, headerInset = 0 }: { page: WorkPage | null; book: Record<string, unknown> | null; model: BookScreenModel; signedIn: boolean; onAdd: () => void; onSelectEdition?: (bookId: string) => void; scrollY?: SharedValue<number>; headerInset?: number }) {
  const { colors, mode } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const coverColor = model.cover.color;
  const wash = coverWash(coverColor, mode);
  const segments = useSegments();
  const workId = page?.work.id;
  const statsQuery = useQuery({ queryKey: ["works", workId, "stats"], queryFn: () => fetchWorkStats(workId!), enabled: Boolean(workId), retry: false });
  const statsTiles = bookStatsModel(statsQuery.data ?? null, page?.work.rating ?? null).tiles;
  const [selected, setSelected] = useState<BookScreenTabKey | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [editionsOpen, setEditionsOpen] = useState(false);
  const tab = model.tabs.some((t) => t.key === selected) ? selected : model.tabs[0]?.key;
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const heading = (title: string) => (
    <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{title}</Text>
  );
  const { about, community } = model;
  useEffect(() => {
    scrollY?.set(0);
  }, [scrollY]);
  const onScroll = useAnimatedScrollHandler((event) => {
    if (scrollY) scrollY.set(event.contentOffset.y);
  });

  return (
    <Animated.ScrollView style={{ marginTop: headerInset }} contentContainerStyle={styles.content} onScroll={onScroll} scrollEventThrottle={16}>
      {wash && coverColor && !scrollY ? <WashGradient color={coverColor} topAlpha={wash.topAlpha} width={windowWidth} /> : null}
      <View style={styles.heroCentered}>
        {page && model.edition && onSelectEdition ? (
          <EditionStrip editions={page.work.editions} book={book} edition={model.edition} onSelect={onSelectEdition} />
        ) : book ? (
          <View style={[styles.cover, { backgroundColor: colors.border }]}>
            <CoverImage book={book} size="full" />
          </View>
        ) : (
          <BookCover cover={page?.work.coverUrl ?? null} title={model.title} width={112} height={168} />
        )}
        <Text {...dynamicType} style={[typography.heading, styles.centeredText, { color: colors.text }]}>{model.title}</Text>
        {model.series ? <SeriesLine series={model.series} signedIn={signedIn} segments={segments} /> : null}
        <Text {...dynamicType} style={[typography.body, styles.centeredText, { color: colors.textDim }]}>{model.author}</Text>
        {model.authorAwards ? <Text {...dynamicType} style={[typography.caption, styles.centeredText, { color: colors.textDim }]}>{model.authorAwards}</Text> : null}
        {model.awards.length > 0 ? (
          <View style={styles.chips}>
            {model.awards.map((award) => (
              <View key={award.label} style={[styles.chip, styles.pill, award.won ? { borderColor: colors.accentSoft, backgroundColor: colors.accentSoft } : { borderColor: colors.border }]}>
                {award.won ? <Icon name="champion" size={12} color={colors.accent} /> : null}
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.shrink, { color: award.won ? colors.accent : colors.textDim }]}>{award.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {model.genres.length + model.possibleGenres.length > 0 ? (
          <View style={styles.chips}>
            {model.genres.map((genre) => (
              <View key={genre} style={[styles.chip, { borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{genre}</Text>
              </View>
            ))}
            {model.possibleGenres.map((genre) => (
              <View key={genre} style={[styles.chip, styles.possibleChip, { borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{`Possibly ${genre}`}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {model.rating ? <RatingStars value={model.rating.value} label={model.rating.label} /> : null}
        {page ? <StatsTiles tiles={statsTiles} onPress={() => router.push(workStatsPath(page.work.id, segments) as never)} /> : null}
        {model.meta ? <Text {...dynamicType} style={[typography.caption, styles.centeredText, { color: colors.textDim }]}>{model.meta}</Text> : null}
      </View>

      {model.primary === "add" ? <Button label={model.edition ? "Add this edition" : "Add to library"} variant="primary" onPress={onAdd} /> : null}
      {model.primary === "owner" && book ? <OwnerRow book={book} model={model} /> : null}

      {model.tabs.length > 1 && tab ? (
        <View accessibilityLabel="Book sections" accessibilityRole="tablist" style={[styles.tabs, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {model.tabs.map((t, i) => {
            const checked = t.key === tab;
            return (
              <Pressable
                key={t.key}
                accessibilityLabel={t.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: checked }}
                onPress={() => setSelected(t.key)}
                style={({ pressed }) => [styles.tab, i > 0 ? { borderLeftWidth: 1, borderColor: colors.border } : null, { backgroundColor: checked ? colors.accentSoft : pressed ? colors.surfacePressed : "transparent" }]}
              >
                <Icon name={TAB_ICONS[t.key]} size={22} color={checked ? colors.accent : colors.textDim} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {tab === "about" && about ? (
        <>
          {about.summary ? (
            <View style={styles.section}>
              {heading("About this book")}
              <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{aboutOpen || !about.preview ? about.summary : about.preview}</Text>
              {about.preview ? <Button label={aboutOpen ? "Show less" : "Show more"} variant="secondary" onPress={() => setAboutOpen(!aboutOpen)} /> : null}
            </View>
          ) : null}
          {about.editions.length > 0 ? (
            <View style={styles.section}>
              {heading("Editions")}
              {(editionsOpen ? about.editions : about.editionsPreview).map((edition) => (
                <Text key={edition.bookId} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>
                  <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{edition.title}</Text>
                  {` · ${editionLabel(edition)}${edition.mine ? " · Yours" : ""}`}
                </Text>
              ))}
              {about.editions.length > about.editionsPreview.length ? (
                <Button label={editionsOpen ? "Show fewer" : `Show all ${about.editions.length}`} variant="secondary" onPress={() => setEditionsOpen(!editionsOpen)} />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {tab === "highlights" ? (
        <View style={styles.section}>
          {model.highlights.length === 0 ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No highlights yet.</Text> : null}
          {model.highlights.map((h, i) => (
            <View key={String(h.BookmarkID ?? i)} style={[styles.highlight, { borderColor: colors.border }]}>
              <Text {...dynamicType} style={[typography.body, styles.quote, { color: colors.text }]}>{String(h.Text)}</Text>
              {String(h.Annotation ?? "").trim() !== "" ? (
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{String(h.Annotation)}</Text>
              ) : null}
              {book && String(h.BookmarkID ?? "").startsWith("note:") ? <DeleteNote book={book} bookmarkId={String(h.BookmarkID)} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      {tab === "community" && community ? (
        <>
          <View style={styles.section}>
            <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{community.countsLabel}</Text>
            {community.groups.map((group) => (
              <View key={group.key} style={styles.group}>
                {group.title ? <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.textDim }]}>{group.title}</Text> : null}
                {group.rows.map((row) => {
                  const body = (
                    <>
                      <AuthorAvatar username={row.username} avatarUrl={row.avatarUrl} />
                      <View style={styles.nameRow}>
                        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.name, { color: colors.text }]}>{row.username}</Text>
                        <ReaderGlyph identity={row.readerGlyph} />
                      </View>
                      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{row.status}</Text>
                    </>
                  );
                  return row.linksToProfile && signedIn ? (
                    <Pressable key={row.username} accessibilityRole="button" accessibilityLabel={`Open ${row.username}'s profile, ${row.status}`} onPress={() => openProfile(row.username)} style={[card, styles.row]}>
                      {body}
                    </Pressable>
                  ) : (
                    <View key={row.username} style={[card, styles.row]}>{body}</View>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.section}>
            {heading("Games")}
            {community.games.length === 0 ? (
              <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No public games use this book yet.</Text>
            ) : (
              community.games.map((game) => (
                <Pressable key={game.key} accessibilityRole="button" accessibilityLabel={`${game.title}, ${game.detail}`} onPress={() => router.push(game.path as never)} style={card}>
                  <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{game.title}</Text>
                  <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{game.detail}</Text>
                </Pressable>
              ))
            )}
          </View>
        </>
      ) : null}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge },
  wash: { position: "absolute", top: 0, left: 0 },
  washLayer: { position: "absolute", top: 0, left: 0 },
  backdropBand: { position: "absolute", top: 0, left: 0, right: 0 },
  backdropWash: { position: "absolute", left: 0, right: 0, bottom: 0, overflow: "hidden" },
  heroCentered: { alignItems: "center", gap: spacing.xs },
  cover: { width: 112, height: 168, borderRadius: radii.sm, overflow: "hidden" },
  centeredText: { alignSelf: "stretch", textAlign: "center" },
  stretch: { alignSelf: "stretch" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, justifyContent: "center" },
  chip: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm },
  possibleChip: { borderStyle: "dashed" },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: "100%" },
  shrink: { flexShrink: 1 },
  section: { gap: spacing.sm },
  group: { gap: spacing.sm },
  primaryRow: { flexDirection: "row", gap: spacing.sm, minHeight: 44 },
  tabs: { flexDirection: "row", borderWidth: 1, borderRadius: radii.md, overflow: "hidden" },
  tab: { flex: 1, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  menuButton: { minHeight: 44, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  strong: { fontWeight: "700" },
  quote: { fontStyle: "italic" },
  highlight: { borderLeftWidth: 2, paddingLeft: spacing.md, gap: spacing.xs },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center" },
  nameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  name: { flexShrink: 1 },
});
