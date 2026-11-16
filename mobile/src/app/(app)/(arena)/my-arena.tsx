import { useLocalSearchParams } from "expo-router";
import { ArenaHomeScreen } from "@/features/arena/ArenaHomeScreen";

export default function ArenaPage() {
  const { pane, t } = useLocalSearchParams<{ pane?: string; t?: string }>();
  return <ArenaHomeScreen pane={pane} t={t} />;
}
