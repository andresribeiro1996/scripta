import { Redirect } from "expo-router";

export default function OAuthSuccessRoute() {
  return <Redirect href="/login" />;
}
