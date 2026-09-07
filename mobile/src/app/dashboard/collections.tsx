import { Redirect } from "expo-router";

export default function CollectionsRoute() {
  return <Redirect href={{ pathname: "/", params: { view: "collections" } } as never} />;
}
