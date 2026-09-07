import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../core/api";
import { useAuth } from "../../core/auth";

interface LibraryResponse {
  data: { book_count: number; books: Array<{ Title: string; Attribution?: string }> } | null;
}

export default function LibraryPage() {
  const { user } = useAuth();
  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => apiClient.request<LibraryResponse>("/library", { auth: true }),
    retry: false,
  });

  const books = library.data?.data?.books ?? [];

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <Text style={styles.headerSub}>
          {user?.username ? `@${user.username}` : user?.email}
          {library.data?.data ? ` — ${library.data.data.book_count} books` : ""}
        </Text>
      </View>
      {library.isPending && (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      )}
      {library.isError && (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn't load the library</Text>
          <Text style={styles.emptyText}>{library.error instanceof Error ? library.error.message : "Unknown error"}</Text>
        </View>
      )}
      {library.isSuccess && (
        <FlatList
          data={books}
          keyExtractor={(item) => item.Title}
          refreshControl={<RefreshControl refreshing={library.isRefetching} onRefresh={() => library.refetch()} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.coverPlaceholder}>
                <Text style={styles.coverInitial}>{item.Title.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.Title}
                </Text>
                <Text style={styles.author} numberOfLines={1}>
                  {item.Attribution ?? "Unknown"}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No library saved yet</Text>
              <Text style={styles.emptyText}>Import arrives with Wave 3.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fafaf9" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  header: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#e7e5e4" },
  headerTitle: { fontSize: 28, fontWeight: "700", color: "#1c1917" },
  headerSub: { fontSize: 13, color: "#78716c", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, gap: 14 },
  coverPlaceholder: {
    width: 44,
    height: 62,
    borderRadius: 6,
    backgroundColor: "#e7e5e4",
    justifyContent: "center",
    alignItems: "center",
  },
  coverInitial: { fontSize: 20, fontWeight: "600", color: "#78716c" },
  title: { fontSize: 16, fontWeight: "600", color: "#1c1917" },
  author: { fontSize: 13, color: "#78716c", marginTop: 2 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#1c1917" },
  emptyText: { fontSize: 14, color: "#78716c", marginTop: 4, textAlign: "center" },
});
