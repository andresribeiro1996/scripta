import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { bookKey, upNextPair } from "@scripta/shared";
import { Button, Sheet, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";
import { DuelButton } from "../library/components/DuelButton";
import { useLibraryActions } from "../library/hooks/useLibraryActions";

export function PickNextSheet({ visible, keys, books, onClose }: { visible: boolean; keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void }) {
  const { colors } = useTheme();
  const { setStatus } = useLibraryActions();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pairKeys = upNextPair(keys, offset);
  const pair = pairKeys
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  if (pairKeys.length < 2) return null;

  const close = () => {
    setOffset(0);
    onClose();
  };

  async function choose(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    const saved = await setStatus(book, 1);
    setSaving(false);
    if (saved !== false) close();
  }

  return (
    <Sheet visible={visible} title="Pick your next read" onClose={close}>
      <View style={styles.pair}>
        {pair.map((book) => (
          <View key={bookKey(book)} style={styles.side}>
            <View style={[styles.cover, { backgroundColor: colors.border }]}><CoverImage book={book} /></View>
            <Text numberOfLines={2} style={[typography.body, { color: colors.text, textAlign: "center" }]}>{String(book.Title ?? "Untitled")}</Text>
            <View style={styles.duelWrap}>
              <DuelButton
                label="This one"
                accessibilityLabel={`This one: ${String(book.Title ?? "Untitled")}`}
                disabled={saving}
                onPress={() => void choose(book)}
              />
            </View>
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
  duelWrap: { marginTop: "auto" },
});
