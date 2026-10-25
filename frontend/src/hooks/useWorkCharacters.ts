import { useEffect, useState } from "react";
import { fetchWorkCharacters } from "../api/works";

export function useWorkCharacters(workIds: string[]): { characters: Record<string, string[]>; failed: boolean } {
  const key = [...new Set(workIds.filter(Boolean))].sort().join("\n");
  const [result, setResult] = useState<{ key: string; characters: Record<string, string[]>; failed: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchWorkCharacters(key.split("\n")).then(
      ({ characters }) => {
        if (!cancelled) setResult({ key, characters, failed: false });
      },
      () => {
        if (!cancelled) setResult({ key, characters: {}, failed: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return result?.key === key ? result : { characters: {}, failed: false };
}
