import { useEffect, useState } from "react";
import { router, useSegments } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { bookStatsModel, bookKey, coverWash, seriesLabel, type BookScreenModel, type BookScreenTabKey, type WorkPage } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { ConfirmDialog, Icon, captionHitSlop, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme, type ActionItem, type IconName } from "../../ui";
import { useLibraryActions } from "../library/hooks/useLibraryActions";
import { BookCover } from "../arena/BookCover";
import { CoverImage } from "../library/components/CoverImage";
import { fetchWorkStats } from "./api";
import { StatsTiles } from "./BookStats";
import { bookToolPath, seriesSearchHref, seriesSearchMethod, workCharactersPath, workStatsPath } from "./workPath";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { statusBadgeLabel } from "./bookPage";
import { CharactersSheet } from "./CharactersSheet";
import { EditionsSheet } from "./EditionsSheet";
import { StatusSheet } from "./StatusSheet";
import { useLocale } from "../../i18n";

const COVER_WIDTH = 150;
const COVER_HEIGHT = 225;
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

export function bookMenuItems(model: BookScreenModel, key: string, segments: readonly string[]): ActionItem[] {
  const to = (tool: "style" | "cover") => () => router.push(bookToolPath(key, tool, segments) as never);
  return model.menu.flatMap<ActionItem>((item) => (item === "style" ? [{ label: "Card style", icon: "style", onPress: to("style") }] : item === "cover" ? [{ label: "Change cover", icon: "image", onPress: to("cover") }] : []));
}

function SheetRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.sheetRow, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}>
      <Icon name={icon} size={20} color={colors.textDim} />
      <Text {...dynamicType} style={[typography.body, styles.shrink, styles.grow, { color: colors.text }]}>{label}</Text>
      <Icon name="chevronRight" size={16} color={colors.textDim} />
    </Pressable>
  );
}

function StatusBadge({ label, finished, onPress }: { label: string; finished: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Reading status: ${label}`} hitSlop={{ top: 8, bottom: 8 }} onPress={onPress} style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
      {finished ? <Icon name="confirm" size={14} color={colors.accent} /> : null}
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.shrink, { color: colors.accent }]}>{label}</Text>
      <Icon name="chevronDown" size={14} color={colors.accent} />
    </Pressable>
  );
}

function SeriesLine({ series, signedIn, segments }: { series: NonNullable<BookScreenModel["series"]>; signedIn: boolean; segments: readonly string[] }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const label = seriesLabel(series, locale);
  const method = signedIn ? seriesSearchMethod(segments) : null;
  if (!method) return <Text {...dynamicType} style={[typography.body, styles.shrink, styles.centerText, { color: colors.textDim }]}>{label}</Text>;
  return (
    <Pressable accessibilityRole="link" hitSlop={captionHitSlop} onPress={() => router[method](seriesSearchHref(series.name, Date.now(), method) as never)} style={styles.shrink}>
      <Text {...dynamicType} style={[typography.body, styles.centerText, { color: colors.text, textDecorationLine: "underline", textDecorationColor: colors.accent }]}>{label}</Text>
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

export function BookScreen({ page, book, model, signedIn, onSelectEdition, scrollY, headerInset = 0 }: { page: WorkPage | null; book: Record<string, unknown> | null; model: BookScreenModel; signedIn: boolean; onSelectEdition?: (bookId: string) => void; scrollY?: SharedValue<number>; headerInset?: number }) {
  const locale = useLocale();
  const { colors, mode } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const coverColor = model.cover.color;
  const wash = coverWash(coverColor, mode);
  const segments = useSegments();
  const workId = page?.work.id;
  const statsQuery = useQuery({ queryKey: ["works", workId, "stats"], queryFn: () => fetchWorkStats(workId!), enabled: Boolean(workId), retry: false });
  const statsTiles = bookStatsModel(statsQuery.data ?? null, page?.work.rating ?? null, locale).tiles;
  const [selected, setSelected] = useState<BookScreenTabKey | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [editionsOpen, setEditionsOpen] = useState(false);
  const tab = model.tabs.some((t) => t.key === selected) ? selected : model.tabs[0]?.key;
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const heading = (title: string) => (
    <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{title}</Text>
  );
  const { about, community } = model;
  const badgeLabel = statusBadgeLabel(model);
  const allCharacters = [...model.characters.shown, ...model.characters.more];
  const showOwnCover = model.edition === null || model.edition.index === model.edition.mineIndex;
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
        <View style={[styles.cover, { backgroundColor: colors.border }]}>
          {book && showOwnCover ? <CoverImage book={book} size="full" /> : <BookCover key={model.cover.url ?? "none"} cover={model.cover.url} title={model.title} width={COVER_WIDTH} height={COVER_HEIGHT} />}
        </View>
        <Text {...dynamicType} style={[typography.heading, styles.centeredText, { color: colors.text }]}>{model.title}</Text>
        <Text {...dynamicType} style={[typography.input, styles.centeredText, { color: colors.textDim }]}>{`by ${model.author}`}</Text>
        {book && badgeLabel ? <StatusBadge label={badgeLabel} finished={model.status?.options.find((o) => o.selected)?.value === 2} onPress={() => setStatusOpen(true)} /> : null}
        {model.series || model.year !== null || model.rating ? (
          <View style={styles.metaRow}>
            {model.series ? (
              <View style={styles.metaPart}>
                <SeriesLine series={model.series} signedIn={signedIn} segments={segments} />
                {model.year !== null || model.rating ? <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>·</Text> : null}
              </View>
            ) : null}
            {model.year !== null ? <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{model.rating ? `${model.year} ·` : String(model.year)}</Text> : null}
            {model.rating ? (
              <View style={styles.metaPart}>
                <Icon name="star" size={14} color={colors.accent} />
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{model.rating.label}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {model.authorAwards ? <Text {...dynamicType} style={[typography.body, styles.centeredText, { color: colors.textDim }]}>{model.authorAwards}</Text> : null}
        {model.awards.length > 0 ? (
          <View style={styles.chips}>
            {model.awards.map((award) => (
              <View key={award.label} style={[styles.chip, styles.pill, award.won ? { borderColor: colors.accentSoft, backgroundColor: colors.accentSoft } : { borderColor: colors.border }]}>
                {award.won ? <Icon name="champion" size={14} color={colors.accent} /> : null}
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.shrink, { color: award.won ? colors.accent : colors.textDim }]}>{award.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {model.genres.length + model.possibleGenres.length > 0 ? (
          <View style={[styles.chips, styles.genres]}>
            {model.genres.map((genre) => (
              <View key={genre} style={[styles.chip, { borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{genre}</Text>
              </View>
            ))}
            {model.possibleGenres.map((genre) => (
              <View key={genre} style={[styles.chip, styles.possibleChip, { borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{`Possibly ${genre}`}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {model.tabs.length > 1 && tab ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Book sections" accessibilityRole="tablist" style={[styles.tabs, { borderColor: colors.border }]} contentContainerStyle={styles.tabsContent}>
          {model.tabs.map((t) => {
            const checked = t.key === tab;
            return (
              <Pressable
                key={t.key}
                accessibilityLabel={t.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: checked }}
                onPress={() => setSelected(t.key)}
                style={[styles.tab, { borderColor: checked ? colors.accent : "transparent" }]}
              >
                <Text numberOfLines={1} {...dynamicType} style={[typography.body, checked ? styles.strong : null, { color: checked ? colors.accent : colors.textDim }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {tab === "about" && about ? (
        <>
          {about.summary ? (
            <View style={styles.section}>
              <Text {...dynamicType} style={[typography.input, styles.synopsis, { color: colors.text }]}>{aboutOpen || !about.preview ? about.summary : about.preview}</Text>
              {about.preview ? (
                <Pressable accessibilityRole="button" onPress={() => setAboutOpen(!aboutOpen)} style={styles.link}>
                  <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.accent }]}>{aboutOpen ? "Show less" : "Show more"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={styles.rows}>
            {onSelectEdition && about.editions.length >= 2 ? <SheetRow icon="library" label={`${about.editions.length} editions`} onPress={() => setEditionsOpen(true)} /> : null}
            {allCharacters.length > 0 ? <SheetRow icon="characters" label={`${allCharacters.length} ${allCharacters.length === 1 ? "character" : "characters"}`} onPress={() => setCharactersOpen(true)} /> : null}
            {book ? <SheetRow icon="image" label="Change cover" onPress={() => router.push(bookToolPath(bookKey(book), "cover", segments) as never)} /> : null}
          </View>
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
            {page ? <StatsTiles tiles={statsTiles} onPress={() => router.push(workStatsPath(page.work.id, segments) as never)} /> : null}
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

      {book && model.status ? <StatusSheet book={book} model={model} visible={statusOpen} onClose={() => setStatusOpen(false)} /> : null}
      {page && onSelectEdition && about && about.editions.length >= 2 ? (
        <EditionsSheet editions={about.editions} selectedIndex={model.edition?.index ?? 0} mineIndex={model.edition?.mineIndex ?? null} visible={editionsOpen} onClose={() => setEditionsOpen(false)} onSelect={onSelectEdition} />
      ) : null}
      {page && allCharacters.length > 0 ? (
        <CharactersSheet characters={allCharacters} gamePath={model.characters.canMakeGame && signedIn ? workCharactersPath(page.work.id, segments) : null} visible={charactersOpen} onClose={() => setCharactersOpen(false)} />
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
  heroCentered: { alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
  cover: { width: COVER_WIDTH, height: COVER_HEIGHT, borderRadius: radii.sm, overflow: "hidden", marginBottom: spacing.xs },
  badge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: "100%", borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  metaRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: spacing.xs },
  metaPart: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: "100%" },
  genres: { marginTop: spacing.xs },
  centerText: { textAlign: "center" },
  grow: { flex: 1 },
  synopsis: { lineHeight: 26 },
  link: { minHeight: minimumTouchTarget, alignSelf: "flex-start", justifyContent: "center" },
  rows: { gap: spacing.sm },
  sheetRow: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  centeredText: { alignSelf: "stretch", textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, justifyContent: "center" },
  chip: { borderWidth: 1, borderRadius: radii.full, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  possibleChip: { borderStyle: "dashed" },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: "100%" },
  shrink: { flexShrink: 1 },
  section: { gap: spacing.sm },
  group: { gap: spacing.sm },
  tabs: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  tabsContent: { columnGap: spacing.xl },
  tab: { minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", borderBottomWidth: 2 },
  strong: { fontWeight: "700" },
  quote: { fontStyle: "italic" },
  highlight: { borderLeftWidth: 2, paddingLeft: spacing.md, gap: spacing.xs },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center" },
  nameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  name: { flexShrink: 1 },
});
