import { router, Stack } from "expo-router";
import { IconButton } from "../../ui";
import { useT } from "../../i18n";

export function SharedHeader({ title }: { title: string }) {
  const t = useT();
  return <Stack.Screen options={{
    headerShown: true,
    title,
    headerLeft: router.canGoBack() ? undefined : () => <IconButton accessibilityLabel={t("shell.back")} name="back" onPress={() => router.replace("/")} />,
  }} />;
}
