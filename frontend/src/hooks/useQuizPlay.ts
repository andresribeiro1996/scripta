import { useQuery } from "@tanstack/react-query";
import { fetchPlayApi, fetchPlayBoard } from "../api/quizzes";

const playStorageKey = (code: string) => `quiz-play-${code}`;

export function useQuizPlay(code: string) {
  const board = useQuery({ queryKey: ["quizBoard", code], queryFn: () => fetchPlayBoard(code), retry: false });
  // Read only once the board resolved, so a bad code never touches
  // storage; a signed-in player has no stored id and passes null, which
  // the backend answers from their account.
  const playId = board.isSuccess ? localStorage.getItem(playStorageKey(code)) : null;
  const ownPlay = useQuery({
    queryKey: ["quizOwnPlay", code, playId],
    queryFn: () => fetchPlayApi(code, playId),
    enabled: board.isSuccess,
    retry: false
  });
  return { board, ownPlay, playId };
}

export function storePlayId(code: string, playId: string): void {
  localStorage.setItem(playStorageKey(code), playId);
}
