import { useLocalSearchParams } from "expo-router";
import { SearchScreen } from "@/features/search/SearchScreen";

export default function SearchRoute() {
  const { q, t } = useLocalSearchParams<{ q?: string | string[]; t?: string | string[] }>();
  return <SearchScreen q={q} t={t} />;
}
