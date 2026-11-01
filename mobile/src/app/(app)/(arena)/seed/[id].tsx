import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { ErrorState, Skeleton } from "@/ui";
import { fetchMyTournaments } from "@/features/arena/api";
import { ArenaSeedScreen } from "@/features/arena/ArenaSeedScreen";
import { useT } from "@/i18n";

export default function ArenaSeedRoute() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({ queryKey: ["arena", "mine"], queryFn: fetchMyTournaments, retry: false });
  const tournament = query.data?.find((item) => item.id === id);
  if (query.isPending) return <View style={{ flex: 1, padding: 24 }}><Skeleton height={180} /></View>;
  if (query.isError || !tournament) return <ErrorState title={t("shell.tournamentUnavailable")} actionLabel={t("shell.back")} onAction={() => router.back()} />;
  return <ArenaSeedScreen tournament={tournament} onStarted={(tournamentId) => { router.dismiss(); router.push(`/arena/${tournamentId}` as never); }} />;
}
