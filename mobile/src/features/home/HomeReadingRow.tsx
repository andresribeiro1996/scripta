import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { bookKey, readingPercent, type LibraryBook } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { useT } from "../../i18n";
import { CoverImage } from "../library/components/CoverImage";
import { currentRead } from "./homeModel";

export function HomeReadingRow({ books }: { books: LibraryBook[] | undefined }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const book = currentRead(books);
  if (!book) return null;
  const percent = readingPercent(book);
  const caption = percent !== null ? t("community.homeReadingPercent", { percent }) : t("community.homeReading");
  const title = String(book.Title ?? "");
  const attribution = book.Attribution ? String(book.Attribution) : "";
  return <Pressable accessibilityRole="link" onPress={() => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never)} style={[styles.row, { backgroundColor: colors.surface }]}>
    <View style={styles.cover}><CoverImage book={book} /></View>
    <View style={styles.text}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.accent }]}>{caption}</Text>
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{attribution ? `${title} · ${attribution}` : title}</Text>
    </View>
    <Icon name="chevronRight" size={16} color={colors.textDim} />
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: minimumTouchTarget, marginHorizontal: spacing.md, marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  cover: { width: 36, height: 54, borderRadius: radii.sm, overflow: "hidden" },
  text: { flex: 1, minWidth: 0 },
  strong: { fontWeight: "700" }
});
