import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { readerGlyphLabel } from "@scripta/shared";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { personCaption, type PersonResult, type SuggestedReader } from "@scripta/shared/community";
import { BookCover } from "../arena/BookCover";
import { AuthorAvatar, openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";
import { useLocale } from "../../i18n";

export function PersonRow({ person, busy, onToggleFollow, onOpen }: { person: PersonResult | SuggestedReader; busy: boolean; onToggleFollow: () => void; onOpen?: () => void }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const glyphLabel = readerGlyphLabel(person.user.readerGlyph, locale);
  const suggestion = "sharedCount" in person ? person : null;
  const caption = personCaption(person, locale);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[`Open ${person.user.username}'s profile`, glyphLabel, caption].filter(Boolean).join(", ")}
        onPress={() => {
          onOpen?.();
          openProfile(person.user.username);
        }}
        style={[styles.actorRow, styles.grow]}
      >
        <AuthorAvatar username={person.user.username} avatarUrl={person.user.avatarUrl} />
        <View style={styles.grow}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.metaName, { color: colors.text }]}>
              {person.user.username}
            </Text>
            <ReaderGlyph identity={person.user.readerGlyph} />
          </View>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
            {caption}
          </Text>
        </View>
        {suggestion?.sharedBooks.length ? (
          <View style={styles.covers}>
            {suggestion.sharedBooks.slice(0, 3).map((book, index) => (
              <View key={`${index}:${book.coverUrl}`} style={index > 0 ? styles.overlap : undefined}>
                <BookCover cover={book.coverUrl} title={book.title} width={24} height={36} />
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
      {person.private ? null : (
        <Button label={person.viewerFollows ? "Following" : "Follow"} variant={person.viewerFollows ? "secondary" : "primary"} loading={busy} onPress={onToggleFollow} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaName: { flexShrink: 1 },
  covers: { flexDirection: "row", alignItems: "center" },
  overlap: { marginLeft: -6 },
});
