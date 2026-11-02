import { useLocalSearchParams } from "expo-router";
import { SharedCardScreen } from "../../../features/public";

export default function SharedCardRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <SharedCardScreen token={token} />;
}
