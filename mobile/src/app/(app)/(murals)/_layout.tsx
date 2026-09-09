import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export default function MuralsStackLayout() {
  return <Stack screenOptions={useScreenOptions()} />;
}
