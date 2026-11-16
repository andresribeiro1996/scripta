import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { fetchPlayApi, fetchPlayBoard } from "../api/quizzes";
import { useAuth } from "../auth/AuthContext";

const playStorageKey = (code: string) => `quiz-play-${code}`;

export function useQuizPlay(code: string) {
  const { session } = useAuth();
  const signedIn = Boolean(session?.user.username);
  const board = useQuery({ queryKey: ["quizBoard", code], queryFn: () => fetchPlayBoard(code), retry: false });
  const playId = board.isSuccess ? localStorage.getItem(playStorageKey(code)) : null;
  const lookupEnabled = (board.data?.playCount ?? 0) > 0 && (signedIn || playId !== null);
  const ownPlay = useQuery({
    queryKey: ["quizOwnPlay", code, playId],
    queryFn: () => fetchPlayApi(code, playId),
    enabled: lookupEnabled,
    retry: false
  });
  const staleStoredPlay = !signedIn && playId !== null && ownPlay.error instanceof ApiError && ownPlay.error.status === 404;
  useEffect(() => {
    if (staleStoredPlay) localStorage.removeItem(playStorageKey(code));
  }, [staleStoredPlay, code]);
  return { board, ownPlay, playId, lookupEnabled };
}

export function storePlayId(code: string, playId: string): void {
  localStorage.setItem(playStorageKey(code), playId);
}
