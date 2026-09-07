import { ActivityIndicator, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../core/auth";

export default function AppLayout() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/(public)/login" />;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: "#1c1917", tabBarInactiveTintColor: "#a8a29e" }}>
      <Tabs.Screen name="index" options={{ title: "Library" }} />
      <Tabs.Screen name="arena" options={{ title: "Arena" }} />
      <Tabs.Screen name="murals" options={{ title: "Murals" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
