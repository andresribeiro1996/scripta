import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { ErrorState, Screen, Skeleton } from "../../ui";
import { spacing, useTheme } from "../../ui/theme";
import { fetchSharedLibrary } from "./api";
import { PublicLibraryGrid } from "./PublicLibraryGrid";

export function SharedLibraryScreen({ token }: { token: string }) {
  const { colors } = useTheme();
  const query = useQuery({ queryKey: ["shared-library", token], queryFn: () => fetchSharedLibrary(token), enabled: Boolean(token), retry: false });

  if (query.isPending) return <View style={[styles.center, { backgroundColor: colors.background }]}><Skeleton height={180} /></View>;
  if (query.isError || !query.data) return <View style={[styles.center, { backgroundColor: colors.background }]}><ErrorState title="Library unavailable" body="This link is invalid or no longer active." /></View>;
  return <Screen bottom top={false}>
    <Stack.Screen options={{ headerShown: true, title: query.data.data.name || "Library" }} />
    <PublicLibraryGrid library={query.data.data} />
  </Screen>;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: spacing.lg },
});
