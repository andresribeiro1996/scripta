import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/core/auth";
import { MyShelfScreen } from "@/features/community/MyShelfScreen";
import { ProfileScreen } from "@/features/community/ProfileScreen";

export default function CommunityProfileRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user } = useAuth();
  if (username === user?.username) return <MyShelfScreen />;
  return <ProfileScreen key={username} username={username} />;
}
