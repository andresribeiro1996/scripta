import { useLocalSearchParams } from "expo-router";
import { ProfileScreen } from "@/features/community/ProfileScreen";

export default function CommunityProfileRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return <ProfileScreen key={username} username={username} />;
}
