import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "murals/index",
};

export default function MuralsStackLayout() {
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="murals/index" />
    </Stack>
  );
}
