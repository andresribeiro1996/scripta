import { useMemo, useState } from "react";
import { Stack } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { scrubImageFromBooks } from "@scripta/shared";
import { decimalText, type Locale } from "@scripta/shared/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Screen } from "../../ui";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { useLibrary } from "../library/hooks/useLibrary";
import { useMurals } from "../murals/useMurals";
import { useLocale, useT } from "../../i18n";
import { deleteGalleryImage, fetchGalleryImages, uploadGalleryImage, type GalleryImage } from "./api";

const GALLERY_QUERY_KEY = ["gallery"] as const;

function formatBytes(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${decimalText(bytes / 1024 / 1024, locale, 1)} MB`;
}

export function GalleryScreen() {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const gallery = useQuery({ queryKey: GALLERY_QUERY_KEY, queryFn: fetchGalleryImages });
  const { data: library, updateLibrary } = useLibrary();
  const murals = useMurals();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<GalleryImage | null>(null);
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
    onError: (reason) => setError(reason instanceof Error ? reason.message : t("addBook.galleryDeleteFailed")),
  });

  async function pickImage() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t("addBook.galleryPhotoAccessOff"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    try {
      await upload.mutateAsync({ uri: asset.uri, name: asset.fileName ?? `image-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("library.uploadFailed"));
    }
  }

  const usedBy = deleting ? usage.get(deleting.id) ?? 0 : 0;
  const usedByMurals = deleting ? muralUsage.get(deleting.id) ?? 0 : 0;
  const deleteWarning = usedBy || usedByMurals
    ? t(usedByMurals === 1 ? "addBook.galleryDeleteWarningOneMural" : "addBook.galleryDeleteWarning", { count: usedBy, murals: usedByMurals })
    : t("addBook.galleryCantUndo");

  if (gallery.isError) return <ErrorState body={gallery.error.message} actionLabel={t("shell.retry")} onAction={() => void gallery.refetch()} />;

  return (
    <Screen bottom top={false} style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("shell.youGallery"),
          headerRight: () => <IconButton framed label={t("addBook.upload")} accessibilityLabel={t("addBook.uploadImage")} name="add" onPress={() => void pickImage()} />,
        }}
      />
      {upload.isPending ? <Text style={[typography.caption, styles.uploading, { color: colors.textDim }]}>{t("library.uploading")}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}
      <FlatList
        contentContainerStyle={styles.list}
        data={gallery.data ?? []}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={<RefreshControl refreshing={gallery.isRefetching} onRefresh={() => void gallery.refetch()} />}
        ListEmptyComponent={!gallery.isPending ? <EmptyState title={t("addBook.galleryEmptyTitle")} body={t("addBook.galleryEmptyBody")} actionLabel={t("addBook.uploadImage")} onAction={() => void pickImage()} /> : undefined}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Image source={{ uri: item.url }} style={styles.image} contentFit="cover" />
            <Text numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{item.width}×{item.height} · {formatBytes(item.byteSize, locale)}</Text>
            {(usage.get(item.id) ?? 0) > 0 ? <Text style={[typography.caption, { color: colors.accent }]}>{t("addBook.galleryCoverFor", { count: usage.get(item.id) ?? 0 })}</Text> : null}
            {(muralUsage.get(item.id) ?? 0) > 0 ? <Text style={[typography.caption, { color: colors.accent }]}>{t("addBook.galleryUsedByMurals", { count: muralUsage.get(item.id) ?? 0 })}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t("addBook.galleryDeleteImage", { width: item.width, height: item.height })} disabled={remove.isPending} onPress={() => setDeleting(item)} style={styles.deleteButton}>
              <Text style={[typography.body, { color: colors.danger }]}>{t("library.delete")}</Text>
            </Pressable>
          </View>
        )}
      />
      <ConfirmDialog
        visible={deleting !== null}
        title={t("addBook.galleryDeleteTitle")}
        body={deleteWarning}
        confirmLabel={t("library.delete")}
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting, { onSettled: () => setDeleting(null) })}
        onCancel={() => setDeleting(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {},
  uploading: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  title: { ...typography.heading, fontWeight: "700" },
  list: { padding: spacing.sm, flexGrow: 1 },
  card: { flex: 1, margin: spacing.sm, padding: spacing.sm, borderWidth: 1, borderRadius: radii.lg, gap: spacing.xs },
  image: { width: "100%", aspectRatio: 1, borderRadius: radii.md },
  deleteButton: { minHeight: minimumTouchTarget, justifyContent: "center", alignItems: "center" },
});
