import { Redirect, useLocalSearchParams } from "expo-router";

export default function TierlistRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/tierlist/${id}` as never} />;
}
