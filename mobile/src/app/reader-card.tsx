import { Redirect, Stack } from "expo-router";
import { useAuth } from "../core/auth";
import { ReaderCardEditorScreen } from "../features/readerCard/ReaderCardEditorScreen";
import { Screen } from "../ui";

export default function ReaderCardRoute() {
  const { user, ready } = useAuth();
  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { returnTo: "/reader-card" } }} />;
  return (
    <Screen top={false} bottom>
      <Stack.Screen options={{ headerShown: true, title: "Reader card" }} />
      <ReaderCardEditorScreen />
    </Screen>
  );
}
