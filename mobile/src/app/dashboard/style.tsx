import { Redirect } from "expo-router";

export default function StyleRoute() {
  return <Redirect href={{ pathname: "/", params: { view: "style" } } as never} />;
}
