import { useLocalSearchParams } from "expo-router";
import { WorkStatsScreen } from "@/features/works/WorkStatsScreen";

export default function WorkStatsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkStatsScreen key={id} id={id} />;
}
