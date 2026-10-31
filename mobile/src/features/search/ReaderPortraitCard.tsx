import { useId, useMemo } from "react";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { readerCardInputOf, readerGlyphLabel } from "@scripta/shared";
import { themes } from "@scripta/shared/themes";
import { personCaption, type SuggestedReader } from "@scripta/shared/community";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { MuralThumbnail } from "../murals/MuralCanvas";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { muralPreviewOf } from "../public/adapters";
import { useLocale } from "../../i18n";

export function ReaderPortraitCard({ person, width, canvasWidth, busy, onToggleFollow }: { person: SuggestedReader; width: number; canvasWidth: number; busy: boolean; onToggleFollow: () => void }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const fadeId = useId();
  const payload = person.private ? null : person.mural;
  const preview = useMemo(() => {
    if (!payload) return null;
    return muralPreviewOf(payload);
  }, [payload]);
  const glyphLabel = readerGlyphLabel(person.private ? undefined : person.user.readerGlyph, locale);
  const identity = glyphLabel ? person.user.readerGlyph : undefined;
  const fallback = useMemo(() => readerCardInputOf([], [], person.user.username, locale, { state: identity ? "settled" : "unwritten", identity: identity ?? null, runnerUp: null, signal: null, coverage: [] }), [identity, person.user.username, locale]);
  const caption = personCaption(person, locale);
  const palette = preview ? themes[preview.mural.theme].colors : colors;
  return (
    <View style={[styles.card, { width, backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={[`Open ${person.user.username}'s profile`, glyphLabel, caption].filter(Boolean).join(", ")} onPress={() => openProfile(person.user.username)} style={({ pressed }) => [styles.open, { opacity: pressed ? 0.75 : 1 }]}>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.preview, { height: width * 0.8, backgroundColor: palette.background }]}>
          {preview?.mural.coverImageUrl ? <Image source={{ uri: preview.mural.coverImageUrl }} contentFit="cover" style={StyleSheet.absoluteFill} /> : preview?.mural.blocks.length ? (
            <MuralThumbnail mural={preview.mural} canvasWidth={canvasWidth} books={preview.books} images={preview.images} tierlists={preview.tierlists} profile={person.user} shelfThemeOverride={payload?.library.shelfTheme} readerCardOverride={payload?.library.readerCard ?? fallback.card} statsOverride={payload?.library.stats} />
          ) : <View style={styles.fallback}><ReaderCardImage input={fallback} width={width} /></View>}
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
            <Defs><LinearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.surface} stopOpacity={0.12} />
              <Stop offset="0.4" stopColor={colors.surface} stopOpacity={0.18} />
              <Stop offset="0.7" stopColor={colors.surface} stopOpacity={0.65} />
              <Stop offset="1" stopColor={colors.surface} stopOpacity={1} />
            </LinearGradient></Defs>
            <Rect width="1" height="1" fill={`url(#${fadeId})`} />
          </Svg>
        </View>
        <View style={styles.details}>
          <View style={[styles.avatar, { borderColor: colors.surface, backgroundColor: colors.surface }]}>
            <AuthorAvatar username={person.user.username} avatarUrl={person.user.avatarUrl} size={48} />
            {glyphLabel ? <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.surface }]}><ReaderGlyph identity={identity} size={14} /></View> : null}
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
  card: { borderRadius: radii.xl, overflow: "hidden", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)" },
  open: { flex: 1 },
  preview: { overflow: "hidden" },
  fallback: { alignItems: "center", marginTop: -spacing.huge },
  details: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md },
  avatar: { marginTop: -spacing.xxxl, marginBottom: spacing.xs, borderWidth: 2, borderRadius: radii.full, boxShadow: "0 2px 6px rgba(0, 0, 0, 0.12)" },
  badge: { position: "absolute", right: 0, bottom: 0, borderWidth: 1, borderRadius: radii.full },
  name: { fontWeight: "700", textAlign: "center" },
  caption: { textAlign: "center" },
  action: { padding: spacing.md },
});
