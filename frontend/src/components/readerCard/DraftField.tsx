import { useCallback, useEffect, useRef, useState } from "react";
import { draftSaver } from "@scripta/shared";

const DRAFT_DELAY_MS = 600;

export function DraftField({ label, initial, max, onSave }: { label: string; initial: string | null; max: number; onSave: (value: string | null) => Promise<boolean> }) {
  const [draft, setDraft] = useState(initial ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const latest = useRef(onSave);
  useEffect(() => { latest.current = onSave; });
  const [send] = useState(() => draftSaver(initial, (failed, previous) => setDraft((current) => (current === failed ? (previous ?? "") : current))));
  const save = useCallback((value: string) => {
    clearTimeout(timer.current);
    pending.current = null;
    send(value, latest.current);
  }, [send]);
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current !== null) save(pending.current);
  }, [save]);
  return (
    <label className="mt-3 block text-xs text-(--color-text-dim)">
      {label}
      <input
        value={draft}
        maxLength={max}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          clearTimeout(timer.current);
          pending.current = value;
          timer.current = setTimeout(() => save(value), DRAFT_DELAY_MS);
        }}
        onBlur={() => save(draft)}
        className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text)"
      />
      <span className="mt-1 block text-right">{`${draft.length}/${max}`}</span>
    </label>
  );
}
