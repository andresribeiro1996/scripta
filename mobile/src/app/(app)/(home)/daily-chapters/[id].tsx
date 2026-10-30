import { useLocalSearchParams } from "expo-router";
import { DailyChapterDayScreen } from "@/features/dailyChapter/daily-chapter-day-screen";

export default function DailyChapterDayRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DailyChapterDayScreen id={id} />;
}
