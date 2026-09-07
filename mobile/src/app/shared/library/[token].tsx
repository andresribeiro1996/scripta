import { useLocalSearchParams } from "expo-router";
import { SharedLibraryScreen } from "../../../features/public";

export default function SharedLibraryRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <SharedLibraryScreen token={token} />;
}
