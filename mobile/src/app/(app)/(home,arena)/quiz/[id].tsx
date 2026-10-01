import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { ErrorState, Skeleton } from "@/ui";
import { fetchQuizzes, type Quiz } from "@/features/quizzes/api";
import { QuizEditorScreen } from "@/features/quizzes/QuizEditorScreen";

export default function QuizEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["quizzes"], queryFn: fetchQuizzes, retry: false });
  const quiz = query.data?.find((item) => item.id === id);
  if (query.isPending) return <View style={{ flex: 1, padding: 24 }}><Skeleton height={180} /></View>;
  if (query.isError || !quiz) return <ErrorState title="Quiz unavailable" actionLabel="Back" onAction={() => router.back()} />;
  return <QuizEditorScreen quiz={quiz} onUpdated={(updated) => client.setQueryData<Quiz[]>(["quizzes"], (items = []) => items.map((item) => item.id === updated.id ? updated : item))} />;
}
