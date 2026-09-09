import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export default function LibraryStackLayout() {
  return <Stack screenOptions={useScreenOptions()} />;
}
