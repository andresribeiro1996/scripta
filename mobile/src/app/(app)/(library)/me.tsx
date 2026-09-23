import { useAuth } from "@/core/auth";
import { ProfileScreen } from "@/features/community/ProfileScreen";

export default function MyProfileTab() {
  const { user } = useAuth();
  return <ProfileScreen username={user?.username ?? ""} />;
}
