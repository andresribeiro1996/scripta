export type QuizPlayStage = "loading" | "leaderboard" | "result" | "playing";

export function quizPlayStage(input: { playOpen: boolean; hasResult: boolean; ownPlayPending: boolean }): QuizPlayStage {
  if (input.hasResult) return "result";
  if (input.playOpen) return "playing";
  return input.ownPlayPending ? "loading" : "leaderboard";
}
