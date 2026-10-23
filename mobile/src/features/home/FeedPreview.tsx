import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { contrastRatio, type DigestItem } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Icon, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { CoverFan, SLOT_HEIGHT, fanWidth } from "../community/CoverFan";
import { fetchProfile } from "../community/api";
import { MuralThumbnail } from "../murals/MuralCanvas";
import { muralPreviewOf } from "../public/adapters";
import { themes } from "@scripta/shared/themes";
import { feedRowModel } from "./feedRowModel";

export function FeedPreview({ item }: { item: DigestItem }) {
  const { colors } = useTheme();
  if (item.kind === "mural") return <MuralPreview item={item} />;
  if (item.kind === "reading" || item.kind === "completion") {
    const book = item.kind === "reading" ? item.book : item.winner;
    const width = item.kind === "completion" ? 80 : 60;
    return <View style={item.kind === "completion" ? styles.winner : undefined}><BookCover cover={book.coverUrl} title={book.title} width={width} height={width * 1.5} /></View>;
  }
  if (item.kind === "vote" && item.ranking?.length) return <View style={styles.ranking} accessibilityLabel={`Ranking preview by ${item.actor.username}`}>
    {item.ranking.map((tier, index) => <View key={index} style={styles.tier}>
      <View style={[styles.tierLabel, { backgroundColor: tier.color }]}><Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: (contrastRatio("#000000", tier.color) ?? 0) > (contrastRatio("#ffffff", tier.color) ?? 0) ? "#000000" : "#ffffff" }]}>{tier.label}</Text></View>
      {tier.books.map((book, index) => <BookCover key={index} cover={book.coverUrl} title={book.title} width={28} height={42} />)}
    </View>)}
  </View>;
  const covers = item.kind === "vote" ? item.content.covers : feedRowModel(item).covers;
  const quiz = item.kind === "publication" && item.content.kind === "quiz";
  const fan = quiz ? covers.slice(0, 2) : covers;
  if (!(item.kind === "publication" && item.content.kind === "tierlist")) return <View style={{ width: fan.length ? fanWidth(fan.length) : styles.iconTile.width, height: SLOT_HEIGHT }}>
    {fan.length ? <CoverFan covers={fan} inset={0} /> : <View style={[styles.iconTile, { backgroundColor: colors.accentSoft }]}><Icon name={feedRowModel(item).icon} size={24} color={colors.accent} /></View>}
    {quiz ? <View style={[styles.quizBadge, { backgroundColor: colors.surface }]}><Text display {...dynamicType} style={[typography.title, { color: colors.text }]}>?</Text></View> : null}
  </View>;
  return <View style={[styles.covers, { backgroundColor: colors.surface }]}>
    {covers.length ? covers.map((cover, index) => <BookCover key={`${cover}:${index}`} cover={cover} title="Book" width={54} height={81} />) : <Icon name={feedRowModel(item).icon} size={32} color={colors.accent} />}
  </View>;
}

function MuralPreview({ item }: { item: Extract<DigestItem, { kind: "mural" }> }) {
  const palette = themes[item.mural.theme].colors;
  const { width } = useWindowDimensions();
  const profile = useQuery({ queryKey: ["community", "profile", item.actor.username], queryFn: () => fetchProfile(item.actor.username), enabled: !item.mural.coverImageUrl, retry: false });
  const payload = profile.data?.mural?.mural.id === item.mural.id ? profile.data.mural : null;
  const preview = useMemo(() => (payload?.mural.blocks.length ? muralPreviewOf(payload) : null), [payload]);
  return <View style={[styles.mural, { backgroundColor: palette.background }]}>
    {item.mural.coverImageUrl ? <Image source={item.mural.coverImageUrl} style={StyleSheet.absoluteFill} contentFit="cover" /> : preview && payload ? <MuralThumbnail mural={preview.mural} canvasWidth={width - spacing.sm * 2} books={preview.books} images={preview.images} tierlists={preview.tierlists} profile={profile.data?.profile.user} shelfThemeOverride={payload.library.shelfTheme} readerCardOverride={payload.library.readerCard} statsOverride={payload.library.stats} /> : <Icon name="murals" size={48} color={palette.accent} />}
  </View>;
}

const styles = StyleSheet.create({
  winner: { transform: [{ rotate: "5deg" }], marginHorizontal: spacing.xs },
  iconTile: { width: 48, height: 72, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
  covers: { flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "flex-start", flexWrap: "wrap", position: "relative", minHeight: 96 },
  quizBadge: { position: "absolute", left: 16, top: 20, width: 32, height: 32, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  mural: { width: "100%", aspectRatio: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  ranking: { maxWidth: 120, gap: spacing.xs },
  tier: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tierLabel: { width: 24, height: 42, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" }
});
