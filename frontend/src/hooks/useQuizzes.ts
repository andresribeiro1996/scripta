import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteQuizApi, fetchQuizzes } from "../api/quizzes";

export function useQuizzes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["quizzes"], queryFn: fetchQuizzes });

  async function remove(id: string) {
    await deleteQuizApi(id);
    await queryClient.invalidateQueries({ queryKey: ["quizzes"] });
  }

  return { ...query, remove };
}
