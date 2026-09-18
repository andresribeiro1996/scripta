import { Redirect } from "expo-router";

// Series no longer has its own native screen — GroupsView lists series and
// collections together, so this lands on the same place as /dashboard/collections.
export default function SeriesRoute() {
  return <Redirect href="/collections" />;
}
