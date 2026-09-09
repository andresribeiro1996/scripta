import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { ErrorState, Skeleton } from "@/ui";
import { fetchMyTournaments } from "@/features/arena/api";
import { ArenaSeedScreen } from "@/features/arena/ArenaSeedScreen";

export default function ArenaSeedRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({ queryKey: ["arena", "mine"], queryFn: fetchMyTournaments, retry: false });
  const tournament = query.data?.find((item) => item.id === id);
  if (query.isPending) return <View style={{ flex: 1, padding: 24 }}><Skeleton height={180} /></View>;
  if (query.isError || !tournament) return <ErrorState title="Tournament unavailable" actionLabel="Back" onAction={() => router.back()} />;
  return <ArenaSeedScreen tournament={tournament} onClose={() => router.back()} onStarted={(tournamentId) => router.replace(`/arena/${tournamentId}` as never)} />;
}
