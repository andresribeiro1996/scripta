import { Redirect } from "expo-router";

export default function SeriesRoute() {
  return <Redirect href={{ pathname: "/", params: { view: "series" } } as never} />;
}
