import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Button, ConfirmDialog, ErrorState } from "../../../ui/components";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";
import type { ResolvedCoverResponse } from "@scripta/shared";
import { deleteGalleryImage, fetchGalleryImages, uploadGalleryImage, type GalleryImage } from "../../gallery/api";
import type { ResolveCoverParams } from "../api/covers";
import { FoundCovers } from "./FoundCovers";

export function CoverPicker({
  title,
  currentImageId,
  lookup,
  coverUrl,
  onSelect,
  onPickFound,
  onRemoveCover,
  onClose,
}: {
  title: string;
  currentImageId: string | null;
  lookup?: ResolveCoverParams;
  coverUrl?: string | null;
  onSelect: (image: GalleryImage) => void;
  onPickFound?: (cover: ResolvedCoverResponse) => void;
  onRemoveCover: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [images, setImages] = useState<GalleryImage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<GalleryImage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchGalleryImages()
      .then((list) => {
        if (!cancelled) setImages(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load your gallery.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePickAndUpload() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setUploadError("Photo library access is off — enable it in Settings to upload a cover.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploadError(null);
    setUploading(true);
    try {
      const image = await uploadGalleryImage({
        uri: asset.uri,
        name: asset.fileName ?? `cover-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      onSelect(image);
      onClose();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      setUploading(false);
    }
  }

  function deleteImage(image: GalleryImage) {
    setConfirmingDelete(null);
    setUploadError(null);
    setDeletingId(image.id);
    deleteGalleryImage(image.id)
      .then(() => setImages((prev) => prev?.filter((i) => i.id !== image.id) ?? prev))
      .catch(() => setUploadError("Couldn't delete that image — try again."))
      .finally(() => setDeletingId(null));
  }

  const hasCustomCover = Boolean(currentImageId) || Boolean(coverUrl);

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <Button label={uploading ? "Uploading…" : "Upload from your photos…"} loading={uploading} onPress={() => void handlePickAndUpload()} />
        {uploadError && <Text style={[typography.caption, { color: colors.danger }]}>{uploadError}</Text>}

        {hasCustomCover && (
          <Button
            label="Remove custom cover — go back to the normal auto-detected one"
            variant="destructive"
            onPress={() => {
              onRemoveCover();
              onClose();
            }}
          />
        )}

        {lookup && onPickFound && (
          <>
            <FoundCovers lookup={lookup} coverUrl={coverUrl} onPick={onPickFound} />
            <Text accessibilityRole="header" style={[typography.body, { color: colors.text, fontWeight: "600" }]}>
              Your gallery
            </Text>
          </>
        )}

        {loadError && <ErrorState body={loadError} actionLabel="Retry" onAction={() => setLoadError(null)} />}
        {!loadError && images === null && <ActivityIndicator />}
        {images !== null && images.length === 0 && (
          <Text style={[typography.body, { color: colors.textDim }]}>No images in your gallery yet — upload one above.</Text>
        )}
        {images !== null && images.length > 0 && (
          // A plain wrapped grid, not a FlatList — a personal gallery is
          // small enough that virtualizing it buys nothing, and it
          // avoids nesting a VirtualizedList inside this ScrollView.
          <View style={styles.grid}>
            {images.map((item) => (
              <Pressable
                accessibilityLabel="Use this image as the cover"
                accessibilityRole="button"
                key={item.id}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                onLongPress={() => setConfirmingDelete(item)}
                style={[
                  styles.thumb,
                  { borderColor: item.id === currentImageId ? colors.accent : "transparent", backgroundColor: colors.border },
                ]}
              >
                <Image source={{ uri: item.url }} style={styles.thumbImage} contentFit="cover" />
                {deletingId === item.id && (
                  <View style={[StyleSheet.absoluteFill, styles.thumbBusy]}>
                    <ActivityIndicator color="white" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}
        {images !== null && images.length > 0 && (
          <Text style={[typography.caption, { color: colors.textDim }]}>Tap to use as cover. Long-press to delete from your gallery.</Text>
        )}
      </ScrollView>
      <ConfirmDialog
        visible={confirmingDelete !== null}
        title="Delete this image from your gallery?"
        body="Any book using it as a cover will fall back to its normal cover."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmingDelete && deleteImage(confirmingDelete)}
        onCancel={() => setConfirmingDelete(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  thumb: { width: "31%", aspectRatio: 1, borderRadius: radii.md, borderWidth: 2, overflow: "hidden", minHeight: minimumTouchTarget },
  thumbImage: { flex: 1 },
  thumbBusy: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" },
});
