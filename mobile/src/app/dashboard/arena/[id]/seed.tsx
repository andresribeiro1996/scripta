import { Redirect, useLocalSearchParams } from "expo-router";

export default function SeedRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/seed/${id}` as never} />;
}
