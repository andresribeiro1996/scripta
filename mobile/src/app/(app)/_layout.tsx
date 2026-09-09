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

  // Each tab is a group holding its own Stack, so a drill-down inside a tab is
  // a real push — with the platform's back chevron and swipe-back — rather than
  // another tab screen hidden with href: null. The group segments don't appear
  // in the URL, so every path is unchanged.
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="(library)" options={{ title: "Library", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "library" : "library-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="(arena)" options={{ title: "Arena", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "trophy" : "trophy-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="(murals)" options={{ title: "Murals", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "color-palette" : "color-palette-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="(settings)" options={{ title: "Settings", tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? "settings" : "settings-outline"} color={color} size={size} /> }} />
    </Tabs>
  );
}
