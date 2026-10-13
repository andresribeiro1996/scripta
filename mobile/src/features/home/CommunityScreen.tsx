import { useState } from "react";
import { Stack } from "expo-router";
import { Screen, SwipeableTabs } from "../../ui";
import { DiscoverPane } from "../community/DiscoverPane";
import { PeoplePane } from "../community/PeoplePane";
import { COMMUNITY_TABS, type CommunityTab } from "./communityTabs";

export function CommunityScreen({ initialTab }: { initialTab: CommunityTab }) {
  const [tab, setTab] = useState<CommunityTab>(initialTab);
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Community", headerShown: true }} />
      <SwipeableTabs
        accessibilityLabel="Community sections"
        options={COMMUNITY_TABS}
        value={tab}
        onChange={setTab}
        renderPage={(value) => (value === "discover" ? <DiscoverPane /> : <PeoplePane />)}
      />
    </Screen>
  );
}
