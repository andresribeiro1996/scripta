import { useLocalSearchParams } from "expo-router";
import { CommunityScreen } from "@/features/home/CommunityScreen";
import { parseCommunityTab } from "@/features/home/communityTabs";

export default function CommunityRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <CommunityScreen initialTab={parseCommunityTab(tab)} />;
}
