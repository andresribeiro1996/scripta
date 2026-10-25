import { useEffect, useMemo, useState } from "react";
import { fetchWorkCharacters } from "../api/works";

const BATCH = 500;

export function useWorkCharacters(workIds: string[]): { characters: Record<string, string[]>; failed: boolean } {
  const key = useMemo(() => [...new Set(workIds.filter(Boolean))].sort().join("\n"), [workIds]);
  const [result, setResult] = useState<{ key: string; characters: Record<string, string[]>; failed: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ids = key.split("\n");
    void (async () => {
      try {
        const merged: Record<string, string[]> = {};
        for (let i = 0; i < ids.length; i += BATCH) {
          Object.assign(merged, (await fetchWorkCharacters(ids.slice(i, i + BATCH))).characters);
        }
        if (!cancelled) setResult({ key, characters: merged, failed: false });
      } catch {
        if (!cancelled) setResult({ key, characters: {}, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return result?.key === key ? result : { characters: {}, failed: false };
}
