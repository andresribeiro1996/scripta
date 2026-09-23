import { useLocalSearchParams } from "expo-router";
import { VoteTierlistScreen } from "../../features/tierlists/VoteTierlistScreen";

export default function VoteTierlistRoute() {
  const { code, rank } = useLocalSearchParams<{ code: string; rank?: string }>();
  return <VoteTierlistScreen code={code} startInRank={rank === "1"} />;
}
