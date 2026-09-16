import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export default function CommunityStackLayout() {
  return <Stack screenOptions={useScreenOptions()} />;
}
