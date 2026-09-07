import { useLocalSearchParams } from "expo-router";
import { MuralEditorScreen } from "../../../features/murals";

export default function MuralEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MuralEditorScreen id={id} />;
}
