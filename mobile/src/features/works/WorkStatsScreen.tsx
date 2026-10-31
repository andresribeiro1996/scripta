import { useEffect } from "react";
import { router, Stack, useSegments } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, StyleSheet } from "react-native";
import { bookStatsModel } from "@scripta/shared";
import { isPermanentError } from "../../core/apiClient";
import { ErrorState, Screen, Skeleton, spacing } from "../../ui";
import { fetchWork, fetchWorkStats } from "./api";
import { StatsSections } from "./BookStats";
import { workStatsPath } from "./workPath";
import { useLocale } from "../../i18n";

export function WorkStatsScreen({ id }: { id: string }) {
  const locale = useLocale();
  const segments = useSegments();
  const work = useQuery({ queryKey: ["works", id], queryFn: () => fetchWork(id), retry: false });
  const canonicalId = work.data?.work.id;
  const stats = useQuery({ queryKey: ["works", id, "stats"], queryFn: () => fetchWorkStats(id), enabled: canonicalId === id, retry: false });

  const canonicalPath = canonicalId && canonicalId !== id ? workStatsPath(canonicalId, segments) : null;

  useEffect(() => {
    if (canonicalPath) router.replace(canonicalPath as never);
  }, [canonicalPath]);

  const untitled = <Stack.Screen options={{ headerShown: true, title: "Stats" }} />;
  const failed = work.isError && !work.data ? work : stats.isError && !stats.data ? stats : null;
  if (failed) {
    const permanent = isPermanentError(failed.error);
    return (
      <Screen bottom top={false} style={styles.centered}>
        {untitled}
        <ErrorState
          title="Stats unavailable"
          body={failed.error instanceof Error ? failed.error.message : "Couldn't load these stats."}
          actionLabel={permanent ? "Back" : "Retry"}
          onAction={permanent ? () => (router.canGoBack() ? router.back() : router.replace("/")) : () => void failed.refetch()}
        />
      </Screen>
    );
  }
  if (!work.data || canonicalId !== id || !stats.data) return <Screen bottom top={false} style={styles.centered}>{untitled}<Skeleton height={160} /></Screen>;

  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: work.data.work.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <StatsSections model={bookStatsModel(stats.data, work.data.work.rating, locale)} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.lg, gap: spacing.md },
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
});
