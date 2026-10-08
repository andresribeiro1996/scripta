import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { bookKey } from "@scripta/shared";
import { Input, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui";
import { Text } from "../../../ui/Text";

type Book = Record<string, unknown>;

export function BookPickerList({ books, onSelect, isSelected, label = "Search your library" }: { books: Book[]; onSelect: (book: Book) => void; isSelected?: (book: Book) => boolean; label?: string }) {
  const { colors } = useTheme();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? books.filter((book) => String(book.Title ?? "").toLowerCase().includes(needle) || String(book.Attribution ?? "").toLowerCase().includes(needle)) : books;
  }, [books, search]);
  return (
    <View style={styles.list}>
      <Input label={label} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
      {filtered.length === 0 ? <Text style={[typography.body, { color: colors.textDim }]}>No books match.</Text> : null}
      {filtered.map((book, i) => {
        const selected = isSelected?.(book) ?? false;
        return (
          <Pressable
            key={`${bookKey(book)}:${i}`}
            accessibilityRole={isSelected ? "checkbox" : "button"}
            accessibilityState={isSelected ? { checked: selected } : undefined}
            accessibilityLabel={String(book.Title ?? "Untitled")}
            onPress={() => onSelect(book)}
            style={[styles.row, { backgroundColor: selected ? colors.accentSoft : "transparent" }]}
          >
            <Text style={[typography.body, styles.grow, { color: colors.text }]} numberOfLines={1}>
              {String(book.Title ?? "Untitled")} — <Text style={{ color: colors.textDim }}>{String(book.Attribution ?? "Unknown author")}</Text>
            </Text>
            <Text style={{ color: colors.accent, fontWeight: "700" }}>{selected ? "✓" : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: minimumTouchTarget, paddingHorizontal: spacing.sm, borderRadius: radii.md },
  grow: { flex: 1 },
});
