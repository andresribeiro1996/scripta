import { useLocalSearchParams } from "expo-router";
import { WorkScreen } from "@/features/works/WorkScreen";

export default function WorkRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkScreen key={id} id={id} />;
}
