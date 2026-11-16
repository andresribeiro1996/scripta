import { router } from "expo-router";
import { isPermanentError } from "../../core/apiClient";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { ErrorState, Screen, Skeleton } from "../../ui";
import { spacing, useTheme } from "../../ui/theme";
import { useT } from "../../i18n";
import { fetchSharedLibrary } from "./api";
import { PublicLibraryGrid } from "./PublicLibraryGrid";
import { SharedHeader } from "./SharedHeader";

export function SharedLibraryScreen({ token }: { token: string }) {
  const t = useT();
  const { colors } = useTheme();
  const query = useQuery({ queryKey: ["shared-library", token], queryFn: () => fetchSharedLibrary(token), enabled: Boolean(token), retry: false });

  if (query.isPending) return <View style={[styles.center, { backgroundColor: colors.background }]}><SharedHeader title={t("shell.loading")} /><Skeleton height={180} /></View>;
  if (query.isError || !query.data) return <View style={[styles.center, { backgroundColor: colors.background }]}><SharedHeader title={t("sharing.libraryUnavailable")} /><ErrorState title={t("sharing.libraryUnavailable")} body={t("sharing.linkInvalidOrInactive")} actionLabel={isPermanentError(query.error) ? t("shell.notFoundAction") : t("shell.retry")} onAction={isPermanentError(query.error) ? () => router.replace("/") : () => void query.refetch()} /></View>;
  return <Screen bottom top={false}>
    <SharedHeader title={query.data.data.name || t("shell.tabLibrary")} />
    <PublicLibraryGrid library={query.data.data} />
  </Screen>;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: spacing.lg },
});
