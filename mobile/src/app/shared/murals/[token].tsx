import { useLocalSearchParams } from "expo-router";
import { SharedMuralScreen } from "../../../features/public";

export default function SharedMuralRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <SharedMuralScreen token={token} />;
}
