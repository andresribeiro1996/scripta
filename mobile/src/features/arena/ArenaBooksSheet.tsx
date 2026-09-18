import { useQuery } from "@tanstack/react-query";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Sheet, Skeleton, dynamicType, spacing, typography, useTheme } from "../../ui";
import { fetchTournament } from "./api";
import { BookCover } from "./BookCover";

export function ArenaBooksSheet({ id, name, onClose }: { id: string | null; name: string; onClose: () => void }) {
  const { colors } = useTheme();
  const tournament = useQuery({ queryKey: ["arena", id, "preview"], queryFn: () => fetchTournament(id!), enabled: Boolean(id), retry: false });

  return <Sheet visible={id !== null} title={`${name} books`} onClose={onClose}>
    {tournament.isPending ? <Skeleton height={180} /> : tournament.isError ? <ErrorState body="Couldn't load these books." actionLabel="Retry" onAction={() => void tournament.refetch()} /> :
      <FlatList
        data={tournament.data.slots}
        keyExtractor={(slot) => String(slot.slotIndex)}
        style={styles.list}
        contentContainerStyle={styles.content}
        ListEmptyComponent={<EmptyState title="No books seeded" body="Books will appear when the bracket is filled." />}
        renderItem={({ item }) => <View style={styles.book}>
          <BookCover cover={item.cover} title={item.title} width={46} height={66} />
          <View style={styles.text}>
            <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{item.title}</Text>
            <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.author}</Text>
          </View>
        </View>}
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
