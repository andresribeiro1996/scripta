import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { ErrorState, Skeleton } from "../../../ui";
import { fetchTierlists, type Tierlist } from "../../../features/tierlists/api";
import { TierlistEditorScreen } from "../../../features/tierlists/TierlistEditorScreen";

export default function TierlistEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists, retry: false });
  const tierlist = query.data?.find((item) => item.id === id);
  if (query.isPending) return <View style={{ flex: 1, padding: 24 }}><Skeleton height={180} /></View>;
  if (query.isError || !tierlist) return <ErrorState title="Tier list unavailable" actionLabel="Back" onAction={() => router.back()} />;
  return <TierlistEditorScreen tierlist={tierlist} onClose={() => router.back()} onUpdated={(updated) => client.setQueryData<Tierlist[]>(["tierlists"], (items = []) => items.map((item) => item.id === updated.id ? updated : item))} />;
}
