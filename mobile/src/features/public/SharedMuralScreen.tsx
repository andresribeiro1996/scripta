import { useMemo } from "react";
import type { Mural } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Screen, Skeleton } from "../../ui";
import { spacing, typography, useTheme } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import { MuralCanvas } from "../murals";
import type { Tierlist } from "../tierlists/api";
import { reconstructBooks, reconstructTierlists } from "./adapters";
import { fetchSharedMural } from "./api";

export function SharedMuralScreen({ token }: { token: string }) {
  const { colors } = useTheme();
  const query = useQuery({ queryKey: ["shared-mural", token], queryFn: () => fetchSharedMural(token), enabled: Boolean(token), retry: false });
  const books = useMemo(() => query.data ? reconstructBooks(query.data.books, query.data.currentlyReading, query.data.highlights) : [], [query.data]);
  const images = useMemo<GalleryImage[]>(() => Object.entries(query.data?.imageUrls ?? {}).filter((entry): entry is [string, string] => entry[1] !== null).map(([id, url]) => ({ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" })), [query.data]);
  const tierlists = useMemo<Tierlist[]>(() => reconstructTierlists(query.data?.tierlists ?? {}), [query.data]);

  if (query.isPending) return <View style={[styles.center, { backgroundColor: colors.background }]}><Skeleton height={180} /></View>;
  if (query.isError || !query.data) return <View style={[styles.center, { backgroundColor: colors.background }]}><ErrorState title="Mural unavailable" body="This link is invalid or no longer active." /></View>;
  const mural: Mural = { ...query.data.mural, coverImageId: undefined, coverImageUrl: query.data.mural.coverImageUrl ?? undefined, shareToken: null, shareUrl: null, folderId: null, createdAt: "", updatedAt: "" };
  return <Screen bottomInset><ScrollView contentContainerStyle={styles.screen}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{mural.name}</Text>
    {mural.blocks.length ? <MuralCanvas mural={mural} books={books} images={images} tierlists={tierlists} statsOverride={query.data.stats} /> : <EmptyState title="This mural is empty" />}
  </ScrollView></Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg },
  center: { flex: 1, justifyContent: "center", padding: spacing.lg },
  title: { ...typography.heading, fontWeight: "700", marginBottom: spacing.lg },
});
