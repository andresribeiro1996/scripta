import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { bookKey } from "@scripta/shared";
import { Button, Sheet, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";
import { DuelButton } from "../library/components/DuelButton";
import { useLibraryActions } from "../library/hooks/useLibraryActions";

export function PickNextSheet({ visible, keys, books, onClose }: { visible: boolean; keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void }) {
  const { colors } = useTheme();
  const { setStatus } = useLibraryActions();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pair = [keys[offset % keys.length], keys[(offset + 1) % keys.length]]
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  async function choose(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    const saved = await setStatus(book, 1);
    setSaving(false);
    if (saved !== false) onClose();
  }

  return (
    <Sheet visible={visible} title="Pick your next read" onClose={onClose}>
      <View style={styles.pair}>
        {pair.map((book) => (
          <View key={bookKey(book)} style={styles.side}>
            <View style={[styles.cover, { backgroundColor: colors.border }]}><CoverImage book={book} /></View>
            <Text numberOfLines={2} style={[typography.body, { color: colors.text, textAlign: "center" }]}>{String(book.Title ?? "Untitled")}</Text>
            <DuelButton label="This one" onPress={() => void choose(book)} />
          </View>
        ))}
      </View>
      {keys.length > 2 ? <Button label="Another pair" variant="secondary" disabled={saving} onPress={() => setOffset((value) => value + 2)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: "row", gap: spacing.md, alignItems: "stretch" },
  side: { flex: 1, gap: spacing.sm },
  cover: { aspectRatio: 2 / 3, borderRadius: 6, overflow: "hidden" },
});
