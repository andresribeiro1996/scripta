import { router, useLocalSearchParams } from "expo-router";
import { ArenaViewScreen } from "../../features/arena/ArenaViewScreen";

export default function TournamentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ArenaViewScreen id={id} onClose={() => router.back()} />;
}
