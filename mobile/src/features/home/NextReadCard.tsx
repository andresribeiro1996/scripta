import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { bookKey, upNextPair } from "@scripta/shared";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";
import { DuelButton } from "../library/components/DuelButton";
import { useLibraryActions } from "../library/hooks/useLibraryActions";

export function NextReadCard({ keys, books }: { keys: string[]; books: Array<Record<string, unknown>> }) {
  const { colors } = useTheme();
  const { setStatus } = useLibraryActions();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pair = upNextPair(keys, offset)
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  if (pair.length < 2) return null;

  async function start(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    await setStatus(book, 1);
    setSaving(false);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>What's next?</Text>
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Two from your to-read pile. Starting one moves it to Continue reading.</Text>
      <View style={styles.pair}>
        {pair.map((book) => {
          const title = String(book.Title ?? "Untitled");
          return (
            <View key={bookKey(book)} style={styles.side}>
              <View style={[styles.cover, { backgroundColor: colors.border }]}><CoverImage book={book} /></View>
              <Text {...dynamicType} numberOfLines={2} style={[typography.body, styles.title, { color: colors.text }]}>{title}</Text>
              <View style={styles.duelWrap}>
                <DuelButton label="Start this one" accessibilityLabel={`Start reading ${title}`} disabled={saving} onPress={() => void start(book)} />
              </View>
            </View>
          );
        })}
      </View>
      {keys.length > 2 ? <Button label="Another pair" variant="secondary" disabled={saving} onPress={() => setOffset((value) => value + 2)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderRadius: radii.lg },
  pair: { flexDirection: "row", gap: spacing.md, alignItems: "stretch" },
  side: { flex: 1, gap: spacing.sm },
  cover: { aspectRatio: 2 / 3, borderRadius: radii.sm, overflow: "hidden" },
  title: { textAlign: "center" },
  duelWrap: { marginTop: "auto" },
});
