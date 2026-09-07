import { Redirect, useLocalSearchParams } from "expo-router";

export default function MuralRoute() {
  const { muralId } = useLocalSearchParams<{ muralId: string }>();
  return <Redirect href={`/murals/${muralId}` as never} />;
}
