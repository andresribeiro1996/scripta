import { useQuery } from "@tanstack/react-query";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { EmptyState, ErrorState, Sheet, Skeleton, dynamicType, spacing, typography, useTheme } from "../../ui";
import { itemNoun } from "@scripta/shared";
import { useLocale, useT } from "../../i18n";
import { fetchTournament } from "./api";
import { BookCover } from "./BookCover";

export function ArenaBooksSheet({ id, name, character = false, onAddBook, onClose }: { id: string | null; name: string; character?: boolean; onAddBook: (book: { title: string; author: string; coverUrl?: string | null }) => void; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const noun = itemNoun(character, 2, locale);
  const tournament = useQuery({ queryKey: ["arena", id, "preview"], queryFn: () => fetchTournament(id!), enabled: Boolean(id), retry: false });

  return <Sheet visible={id !== null} title={name.toLowerCase().endsWith(noun.toLowerCase()) ? name : t(character ? "arena.charactersSheetTitle" : "arena.booksSheetTitle", { name })} onClose={onClose}>
    {tournament.isPending ? <Skeleton height={180} /> : tournament.isError ? <ErrorState body={t(character ? "arena.loadCharactersFailed" : "arena.loadBooksFailed")} actionLabel={t("shell.retry")} onAction={() => void tournament.refetch()} /> :
      <FlatList
        data={tournament.data.slots}
        keyExtractor={(slot) => String(slot.slotIndex)}
        style={styles.list}
        contentContainerStyle={styles.content}
        ListEmptyComponent={<EmptyState title={t(character ? "arena.noCharactersSeeded" : "arena.noBooksSeeded")} body={t(character ? "arena.charactersWillAppear" : "arena.booksWillAppear")} />}
        renderItem={({ item }) => <Pressable disabled={character} accessibilityLabel={character ? item.title : t("arena.titleByAuthor", { title: item.title, author: item.author })} onPress={() => onAddBook({ title: item.title, author: item.author, coverUrl: item.cover ?? null })} style={styles.book}>
          <BookCover cover={item.cover} title={item.title} width={46} height={66} />
          <View style={styles.text}>
            <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{item.title}</Text>
            {character ? null : <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.author}</Text>}
          </View>
        </Pressable>}
      />}
  </Sheet>;
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  content: { gap: spacing.md, paddingBottom: spacing.md },
  book: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  text: { flex: 1 },
  strong: { fontWeight: "700" },
});
