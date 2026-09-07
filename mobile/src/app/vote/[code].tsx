import { useLocalSearchParams } from "expo-router";
import { VoteTierlistScreen } from "../../features/tierlists/VoteTierlistScreen";

export default function VoteTierlistRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <VoteTierlistScreen code={code} />;
}
