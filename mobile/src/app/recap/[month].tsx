import { useLocalSearchParams } from "expo-router";
import { RecapScreen } from "../../features/topShelf/RecapScreen";

export default function RecapRoute() {
  const { month } = useLocalSearchParams<{ month: string }>();
  return <RecapScreen month={month} />;
}
