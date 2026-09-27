import { useLocalSearchParams } from "expo-router";
import { ActivityScreen } from "@/features/home/ActivityScreen";

export default function ActivityRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <ActivityScreen initialTab={tab === "people" ? "people" : undefined} />;
}
