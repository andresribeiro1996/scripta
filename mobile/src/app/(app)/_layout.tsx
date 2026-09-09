import { ActivityIndicator, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../../core/auth";
import { useTheme } from "../../ui/theme";

export default function AppLayout() {
  const { ready, user } = useAuth();
  const { colors } = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", backgroundColor: colors.background, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(public)/login" />;
  // Google sign-in without a username yet — see choose-username.tsx's own
  // top comment, mirrors the PWA's RequireUsername guard.
  if (!user.username) return <Redirect href="/choose-username" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Was a pair of hardcoded stone hex values, so the bar kept the light
        // palette while every screen above it went dark.
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Library", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "library" : "library-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="my-arena" options={{ title: "Arena", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "trophy" : "trophy-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="murals" options={{ title: "Murals", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "color-palette" : "color-palette-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "settings" : "settings-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="murals/[id]" options={{ href: null }} />
      <Tabs.Screen name="tierlist/[id]" options={{ href: null }} />
      <Tabs.Screen name="seed/[id]" options={{ href: null }} />
    </Tabs>
  );
}
