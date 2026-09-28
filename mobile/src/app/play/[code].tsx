import { useLocalSearchParams } from "expo-router";
import { QuizPlayScreen } from "../../features/quizzes/QuizPlayScreen";

export default function PlayQuizRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <QuizPlayScreen code={code} />;
}
