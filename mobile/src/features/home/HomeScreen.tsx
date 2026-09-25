import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { buildDashboardCards, resolveQuote } from "@scripta/shared";
import { Button, EmptyState, ErrorState, Screen, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { useLibrary } from "../library/hooks/useLibrary";

export function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const library = useLibrary();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [offset, setOffset] = useState(0);
  useFocusEffect(useCallback(() => {
    setDay(new Date().toISOString().slice(0, 10));
    setOffset(0);
    void library.refetch();
  }, [library.refetch]));

  const books = library.data?.data.books ?? [];
  const cards = user ? buildDashboardCards(books, day, `${user.id}:${offset}`) : [];
  const rediscoverCard = cards.find((card) => card.kind === "rediscover");
  const quote = rediscoverCard ? resolveQuote({ type: "quote", bookKey: rediscoverCard.bookKey, highlightId: rediscoverCard.highlightId } as never, books) : null;

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Home",
          headerShown: true,
        }}
      />
      {library.isPending ? (
        <View style={styles.page}>
          <ActivityIndicator accessibilityLabel="Loading home" />
        </View>
      ) : library.isError ? (
        <View style={styles.page}>
          <ErrorState body="Couldn't load your home." actionLabel="Retry" onAction={() => void library.refetch()} />
        </View>
      ) : (
        <View style={styles.grow}>
          {!books.length ? (
            <View style={styles.page}>
              <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." actionLabel="Import library" onAction={() => router.push("/import" as never)} secondaryActionLabel="Add a book manually" onSecondaryAction={() => router.push("/add-book" as never)} />
            </View>
          ) : quote ? (
            <View style={styles.page}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text {...dynamicType} style={[typography.title, styles.heading, { color: colors.text }]}>Rediscover</Text>
                <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{String(quote.highlight.Text)}</Text>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  {String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}
                </Text>
                <Button label="Show another" variant="secondary" onPress={() => setOffset((value) => value + 1)} />
              </View>
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md },
  heading: { fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  grow: { flex: 1 },
});
