import { ActivityIndicator, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../core/auth";
import { ErrorState } from "../../ui/components";
import { Icon } from "../../ui/icon";
import { useTheme } from "../../ui/theme";

export default function AppLayout() {
  const { ready, user, unreachable, retry } = useAuth();
  const { colors } = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", backgroundColor: colors.background, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  // Being unable to reach the server is not being signed out. Sending an
  // offline user to a login form asks them to re-enter a password they do not
  // need, and — before the retry below existed — stranded them there until the
  // app was killed and reopened.
  if (!user && unreachable) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}>
        <ErrorState
          title="Can't reach the server"
          body="You're still signed in — we just couldn't load your account. Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void retry()}
        />
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
      <Tabs.Screen name="(library)" options={{ title: "Library", tabBarIcon: ({ color, focused, size }) => <Icon name="library" filled={focused} color={color} size={size} /> }} />
      <Tabs.Screen name="(arena)" options={{ title: "Arena", tabBarIcon: ({ color, focused, size }) => <Icon name="arena" filled={focused} color={color} size={size} /> }} />
      <Tabs.Screen name="(murals)" options={{ title: "Murals", tabBarIcon: ({ color, focused, size }) => <Icon name="murals" filled={focused} color={color} size={size} /> }} />
      <Tabs.Screen name="(settings)" options={{ title: "Settings", tabBarIcon: ({ color, focused, size }) => <Icon name="settings" filled={focused} color={color} size={size} /> }} />
    </Tabs>
  );
}
