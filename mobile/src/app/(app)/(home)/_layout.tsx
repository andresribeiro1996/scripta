import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export default function HomeLayout() {
  return <Stack screenOptions={useScreenOptions()} />;
}
