import type { DailyChapterHistory } from "@scripta/shared";

export const dailyPlayVariant = (emptyLibrary: boolean): "primary" | "secondary" => (emptyLibrary ? "secondary" : "primary");

export function dailyCardAction(boardId: string, history: DailyChapterHistory | undefined): { kind: "play" } | { kind: "results"; score: number } {
  const result = history?.results.find((item) => item.editionId === boardId);
  return result ? { kind: "results", score: result.score } : { kind: "play" };
}
