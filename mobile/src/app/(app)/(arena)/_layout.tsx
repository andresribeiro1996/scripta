import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export default function ArenaStackLayout() {
  return <Stack screenOptions={useScreenOptions()} />;
}
