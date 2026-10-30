import { useLocalSearchParams } from "expo-router";
import { CastPickerScreen } from "@/features/characters/CastPickerScreen";

export default function WorkCharactersRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CastPickerScreen key={id} workId={id} />;
}
