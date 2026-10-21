import { useLocalSearchParams } from "expo-router";
import { LeaderboardScreen } from "@/features/topShelf/LeaderboardScreen";

export default function LeaderboardPage() {
  const { view, period, genre } = useLocalSearchParams<{ view: string; period?: string; genre?: string }>();
  return <LeaderboardScreen view={view} period={period === "all" ? "all" : "month"} genre={genre || null} />;
}
