import { Stack } from "expo-router";
import { useScreenOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "my-arena",
};

export default function ArenaStackLayout() {
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="my-arena" />
    </Stack>
  );
}
