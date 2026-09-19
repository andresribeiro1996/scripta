import { useLocalSearchParams } from "expo-router";
import { GroupDetail } from "@/features/library/components/GroupDetail";

export default function CollectionDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GroupDetail groupId={id ?? ""} />;
}
