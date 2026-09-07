import { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { scrubImageFromBooks } from "@scripta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, ErrorState } from "../../ui";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { useLibrary } from "../library/hooks/useLibrary";
import { useMurals } from "../murals/useMurals";
import { deleteGalleryImage, fetchGalleryImages, uploadGalleryImage, type GalleryImage } from "./api";

const GALLERY_QUERY_KEY = ["gallery"] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function GalleryScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const gallery = useQuery({ queryKey: GALLERY_QUERY_KEY, queryFn: fetchGalleryImages });
  const { data: library, updateLibrary } = useLibrary();
  const murals = useMurals();
  const [error, setError] = useState<string | null>(null);
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of library?.data.books ?? []) {
      const id = typeof book._coverImageId === "string" ? book._coverImageId : null;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [library]);
  const muralUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mural of murals.data ?? []) {
      if (mural.coverImageId) counts.set(mural.coverImageId, (counts.get(mural.coverImageId) ?? 0) + 1);
      for (const block of mural.blocks) if (block.type === "image" && block.imageId) counts.set(block.imageId, (counts.get(block.imageId) ?? 0) + 1);
    }
    return counts;
  }, [murals.data]);

  const upload = useMutation({
    mutationFn: uploadGalleryImage,
    onSuccess: (image) => queryClient.setQueryData<GalleryImage[]>(GALLERY_QUERY_KEY, (current = []) => [image, ...current]),
  });
  const remove = useMutation({
    mutationFn: async (image: GalleryImage) => {
      await deleteGalleryImage(image.id);
      await murals.scrubImage(image.id);
      if ((usage.get(image.id) ?? 0) > 0) {
        await updateLibrary((data) => ({ ...data, books: scrubImageFromBooks(data.books, image.id) }));
      }
      return image.id;
    },
    onSuccess: (id) => queryClient.setQueryData<GalleryImage[]>(GALLERY_QUERY_KEY, (current = []) => current.filter((image) => image.id !== id)),
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Couldn't delete that image."),
  });

  async function pickImage() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is off. Enable it in device Settings to upload images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    try {
      await upload.mutateAsync({ uri: asset.uri, name: asset.fileName ?? `image-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't upload that image.");
    }
  }

  function confirmDelete(image: GalleryImage) {
    const usedBy = usage.get(image.id) ?? 0;
    const usedByMurals = muralUsage.get(image.id) ?? 0;
    const warning = usedBy || usedByMurals
      ? `Deleting it will remove it from ${usedBy} book${usedBy === 1 ? "" : "s"} and ${usedByMurals} mural reference${usedByMurals === 1 ? "" : "s"}.`
      : "This can't be undone.";
    Alert.alert("Delete this image?", warning, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(image) },
    ]);
  }

  if (gallery.isError) return <ErrorState body={gallery.error.message} actionLabel="Retry" onAction={() => void gallery.refetch()} />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Gallery</Text>
        <Button label={upload.isPending ? "Uploading…" : "Upload image"} loading={upload.isPending} onPress={() => void pickImage()} />
      </View>
      {error ? <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}
      <FlatList
        contentContainerStyle={styles.list}
        data={gallery.data ?? []}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={<RefreshControl refreshing={gallery.isRefetching} onRefresh={() => void gallery.refetch()} />}
        ListEmptyComponent={!gallery.isPending ? <EmptyState title="No images yet" body="Upload an image to use it in your library or murals." /> : null}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Image source={{ uri: item.url }} style={styles.image} contentFit="cover" />
            <Text numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{item.width}×{item.height} · {formatBytes(item.byteSize)}</Text>
            {(usage.get(item.id) ?? 0) > 0 ? <Text style={[typography.caption, { color: colors.accent }]}>Cover for {usage.get(item.id)} book{usage.get(item.id) === 1 ? "" : "s"}</Text> : null}
            {(muralUsage.get(item.id) ?? 0) > 0 ? <Text style={[typography.caption, { color: colors.accent }]}>Used by {muralUsage.get(item.id)} mural reference{muralUsage.get(item.id) === 1 ? "" : "s"}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.filename}`} disabled={remove.isPending} onPress={() => confirmDelete(item)} style={styles.deleteButton}>
              <Text style={[typography.body, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  title: { ...typography.heading, fontWeight: "700" },
  list: { padding: spacing.sm, flexGrow: 1 },
  card: { flex: 1, margin: spacing.sm, padding: spacing.sm, borderWidth: 1, borderRadius: radii.lg, gap: spacing.xs },
  image: { width: "100%", aspectRatio: 1, borderRadius: radii.md },
  deleteButton: { minHeight: minimumTouchTarget, justifyContent: "center", alignItems: "center" },
});
