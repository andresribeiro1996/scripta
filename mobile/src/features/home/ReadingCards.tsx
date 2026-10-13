import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { bookKey } from "@scripta/shared";
import { Button, IconButton, Menu, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";
import { useChangeStatus } from "../library/hooks/useChangeStatus";

const PEEK = 40;

export function ReadingCards({ keys, books, onOpen }: { keys: string[]; books: Array<Record<string, unknown>>; onOpen: (key: string) => void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const changeStatus = useChangeStatus();
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  const items = keys.flatMap((key) => {
    const book = byKey.get(key);
    return book ? [{ key, book }] : [];
  });
  const cardWidth = width - spacing.lg * 2 - (items.length > 1 ? PEEK : 0);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + spacing.md} decelerationRate="fast" contentContainerStyle={styles.row}>
      {items.map(({ key, book }) => {
        const title = String(book.Title ?? "Untitled");
        const author = String(book.Attribution ?? "Unknown author");
        return (
          <View key={key} style={[styles.card, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${title} by ${author}`} onPress={() => onOpen(key)} style={[styles.cover, { backgroundColor: colors.border }]}>
              <CoverImage book={book} />
            </Pressable>
            <View style={styles.body}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={() => onOpen(key)}>
                <Text {...dynamicType} numberOfLines={2} style={[typography.title, { color: colors.text }]}>{title}</Text>
                <Text {...dynamicType} numberOfLines={1} style={[typography.body, { color: colors.textDim }]}>{author}</Text>
              </Pressable>
              <View style={styles.actions}>
                <Button label="Finished" variant="secondary" accessibilityLabel={`Mark ${title} finished`} onPress={() => void changeStatus(book, 2)} />
                <Menu title={title} items={[{ label: "Move to To read", onPress: () => void changeStatus(book, 0) }, { label: "Open book", onPress: () => onOpen(key) }]}>
                  <IconButton accessibilityLabel={`More for ${title}`} name="more" />
                </Menu>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingHorizontal: spacing.lg },
  card: { flexDirection: "row", gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderRadius: radii.lg },
  cover: { width: 72, aspectRatio: 2 / 3, borderRadius: radii.md, overflow: "hidden" },
  body: { flex: 1, minWidth: 0, gap: spacing.sm, justifyContent: "space-between" },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
