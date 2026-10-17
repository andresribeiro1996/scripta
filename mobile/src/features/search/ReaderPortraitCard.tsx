import { useMemo } from "react";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import { ensureBookBlockHeights, readerCardInputOf, readerGlyphLabel, type Mural } from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import { personCaption, type SuggestedReader } from "@scripta/shared/community";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";
import type { GalleryImage } from "../gallery/api";
import { MuralThumbnail } from "../murals/MuralCanvas";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { reconstructBooks, reconstructTierlists } from "../public/adapters";

export function ReaderPortraitCard({ person, width, canvasWidth, busy, onToggleFollow }: { person: SuggestedReader; width: number; canvasWidth: number; busy: boolean; onToggleFollow: () => void }) {
  const { colors } = useTheme();
  const payload = person.private ? null : person.mural;
  const preview = useMemo(() => {
    if (!payload) return null;
    const mural: Mural = { ...payload.mural, blocks: ensureBookBlockHeights(payload.mural.blocks), coverImageUrl: payload.mural.coverImageUrl ?? undefined, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
    const images: GalleryImage[] = Object.entries(payload.imageUrls).flatMap(([id, url]) => url ? [{ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" }] : []);
    return { mural, images, books: reconstructBooks(payload.library.books, payload.library.currentlyReading, payload.library.highlights), tierlists: reconstructTierlists(payload.tierlists) };
  }, [payload]);
  const glyphLabel = readerGlyphLabel(person.private ? undefined : person.user.readerGlyph);
  const identity = glyphLabel ? person.user.readerGlyph : undefined;
  const fallback = useMemo(() => readerCardInputOf([], [], person.user.username, { state: identity ? "settled" : "unwritten", identity: identity ?? null, runnerUp: null, signal: null, coverage: [] }), [identity, person.user.username]);
  const caption = personCaption(person);
  const palette = preview ? themes[preview.mural.theme].colors : colors;
  return (
    <View style={[styles.card, { width, backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={[`Open ${person.user.username}'s profile`, glyphLabel, caption].filter(Boolean).join(", ")} onPress={() => openProfile(person.user.username)} style={({ pressed }) => [styles.open, { opacity: pressed ? 0.75 : 1 }]}>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.preview, { backgroundColor: palette.background }]}>
          {preview?.mural.coverImageUrl ? <Image source={{ uri: preview.mural.coverImageUrl }} contentFit="cover" style={StyleSheet.absoluteFill} /> : preview?.mural.blocks.length ? (
            <MuralThumbnail mural={preview.mural} canvasWidth={canvasWidth} books={preview.books} images={preview.images} tierlists={preview.tierlists} profile={person.user} shelfThemeOverride={payload?.library.shelfTheme} readerCardOverride={payload?.library.readerCard ?? fallback.card} statsOverride={payload?.library.stats} />
          ) : <View style={styles.fallback}><ReaderCardImage input={fallback} width={width - spacing.xl * 2} /></View>}
        </View>
        <View style={styles.details}>
          <View style={[styles.avatar, { borderColor: colors.surface, backgroundColor: colors.surface }]}>
            <AuthorAvatar username={person.user.username} avatarUrl={person.user.avatarUrl} size={48} />
            {glyphLabel ? <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.surface }]}><ReaderGlyph identity={identity} /></View> : null}
          </View>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.name, { color: colors.text }]}>{person.user.username}</Text>
          <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.caption, { color: colors.textDim }]}>{caption}</Text>
        </View>
      </Pressable>
      {person.private ? null : <View style={styles.action}><Button label={person.viewerFollows ? "Following" : "Follow"} accessibilityLabel={`${person.viewerFollows ? "Unfollow" : "Follow"} ${person.user.username}`} variant="secondary" loading={busy} onPress={onToggleFollow} /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.lg, overflow: "hidden" },
  open: { flex: 1 },
  preview: { height: 88, overflow: "hidden" },
  fallback: { alignItems: "center", marginTop: -spacing.xl },
  details: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md },
  avatar: { marginTop: -spacing.xxl, marginBottom: spacing.xs, borderWidth: 3, borderRadius: radii.full },
  badge: { position: "absolute", right: -spacing.xs, bottom: -spacing.xs, borderWidth: 2, borderRadius: radii.full },
  name: { fontWeight: "700", textAlign: "center", minHeight: typography.body.lineHeight * 2 },
  caption: { textAlign: "center", minHeight: typography.caption.lineHeight * 2 },
  action: { padding: spacing.md },
});
