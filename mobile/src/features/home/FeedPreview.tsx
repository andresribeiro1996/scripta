import { useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { contrastRatio, ensureBookBlockHeights, type DigestItem, type Mural } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Icon, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { fetchProfile } from "../community/api";
import { CoverFan, SLOT_HEIGHT, SLOT_WIDTH } from "../community/CoverFan";
import { MuralThumbnail } from "../murals/MuralCanvas";
import { reconstructBooks, reconstructTierlists } from "../public/adapters";
import type { GalleryImage } from "../gallery/api";
import { feedRowModel } from "./feedRowModel";

export function FeedPreview({ item }: { item: DigestItem }) {
  const { colors } = useTheme();
  if (item.kind === "mural") return <MuralPreview item={item} />;
  if (item.kind === "reading" || item.kind === "completion") {
    const book = item.kind === "reading" ? item.book : item.winner;
    const width = item.kind === "completion" ? 80 : 48;
    return <View style={item.kind === "completion" ? styles.winner : undefined}><BookCover cover={book.coverUrl} title={book.title} width={width} height={width * 1.5} /></View>;
  }
  if (item.kind === "vote" && item.ranking?.length) return <View style={[styles.ranking, { backgroundColor: colors.surface }]} accessibilityLabel={`Ranking preview by ${item.actor.username}`}>
    {item.ranking.map((tier, index) => <View key={index} style={styles.tier}>
      <View style={[styles.tierLabel, { backgroundColor: tier.color }]}><Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: (contrastRatio("#000000", tier.color) ?? 0) > (contrastRatio("#ffffff", tier.color) ?? 0) ? "#000000" : "#ffffff" }]}>{tier.label}</Text></View>
      {tier.books.map((book, index) => <BookCover key={index} cover={book.coverUrl} title={book.title} width={28} height={42} />)}
    </View>)}
  </View>;
  const covers = item.kind === "vote" ? item.content.covers : feedRowModel(item).covers;
  const quiz = item.kind === "publication" && item.content.kind === "quiz";
  if (!(item.kind === "publication" && item.content.kind === "tierlist")) return <View style={{ width: SLOT_WIDTH, height: SLOT_HEIGHT }}>
    {covers.length ? <CoverFan covers={quiz ? covers.slice(0, 2) : covers} /> : <View style={styles.emptyPreview}><Icon name={feedRowModel(item).icon} size={32} color={colors.accent} /></View>}
    {quiz ? <View style={[styles.quizBadge, { backgroundColor: colors.surface }]}><Text display {...dynamicType} style={[typography.title, { color: colors.text }]}>?</Text></View> : null}
  </View>;
  return <View style={[styles.covers, { backgroundColor: colors.surface }]}>
    {covers.length ? covers.map((cover, index) => <BookCover key={`${cover}:${index}`} cover={cover} title="Book" width={54} height={81} />) : <Icon name={feedRowModel(item).icon} size={32} color={colors.accent} />}
  </View>;
}

function MuralPreview({ item }: { item: Extract<DigestItem, { kind: "mural" }> }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(240, width - spacing.lg * 2);
  const profile = useQuery({ queryKey: ["community", "profile", item.actor.username], queryFn: () => fetchProfile(item.actor.username), enabled: !item.mural.coverImageUrl, retry: false });
  const data = profile.data?.mural?.mural.id === item.mural.id ? profile.data.mural : null;
  const books = useMemo(() => data ? reconstructBooks(data.library.books, data.library.currentlyReading, data.library.highlights) : [], [data]);
  const images = useMemo<GalleryImage[]>(() => data ? Object.entries(data.imageUrls).flatMap(([id, url]) => url ? [{ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" }] : []) : [], [data]);
  const tierlists = useMemo(() => reconstructTierlists(data?.tierlists ?? {}), [data]);
  const mural: Mural | null = data ? { ...data.mural, blocks: ensureBookBlockHeights(data.mural.blocks), createdAt: "", updatedAt: "", coverImageUrl: data.mural.coverImageUrl ?? undefined, shareToken: null, shareUrl: null, folderId: null } : null;
  return <View style={[styles.mural, { width: size, height: size, backgroundColor: colors.surface }]}>
    {item.mural.coverImageUrl ? <Image source={item.mural.coverImageUrl} style={StyleSheet.absoluteFill} contentFit="cover" /> : mural && mural.blocks.length > 0 && data ? <MuralThumbnail mural={mural} canvasWidth={width - spacing.lg * 2} books={books} images={images} tierlists={tierlists} profile={data.profile} shelfThemeOverride={data.library.shelfTheme} readerCardOverride={data.library.readerCard} statsOverride={data.library.stats} /> : profile.isPending ? <Skeleton height={size} /> : <Icon name="murals" size={48} color={colors.accent} />}
  </View>;
}

const styles = StyleSheet.create({
  winner: { transform: [{ rotate: "5deg" }], marginHorizontal: spacing.xs },
  emptyPreview: { flex: 1, alignItems: "center", justifyContent: "center" },
  covers: { padding: spacing.md, borderRadius: radii.md, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center", flexWrap: "wrap", position: "relative", minHeight: 96 },
  quizBadge: { position: "absolute", left: 30, top: 20, width: 32, height: 32, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  mural: { alignSelf: "center", borderRadius: radii.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  ranking: { width: 120, padding: spacing.sm, gap: spacing.xs, borderRadius: radii.md },
  tier: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tierLabel: { width: 24, height: 42, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" }
});
