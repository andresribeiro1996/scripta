import { useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved";

const LABELS: Record<SaveState, string> = { idle: "", saving: "Saving…", saved: "Saved" };

export function SaveStatus({ state }: { state: SaveState }) {
  return <span role="status" className="block min-h-5">{LABELS[state]}</span>;
}

export function useSaveState(): [SaveState, <T>(save: Promise<T>) => Promise<T>] {
  const [state, setState] = useState<SaveState>("idle");
  const inFlight = useRef(0);
  const track = async <T,>(save: Promise<T>): Promise<T> => {
    inFlight.current += 1;
    setState("saving");
    try {
      const result = await save;
      if (inFlight.current === 1) setState("saved");
      return result;
    } catch (error) {
      if (inFlight.current === 1) setState("idle");
      throw error;
    } finally {
      inFlight.current -= 1;
    }
  };
  return [state, track];
}
