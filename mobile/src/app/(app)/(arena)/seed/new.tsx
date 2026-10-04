import { router } from "expo-router";
import { ArenaSeedScreen } from "@/features/arena/ArenaSeedScreen";

export default function NewTournamentRoute() {
  return <ArenaSeedScreen onStarted={(id) => { router.dismiss(); router.push(`/arena/${id}` as never); }} />;
}
