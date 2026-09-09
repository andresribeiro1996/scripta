import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export default function SettingsStackLayout() {
  return <Stack screenOptions={useScreenOptions()} />;
}
