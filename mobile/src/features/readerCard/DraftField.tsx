import { useEffect, useState, type RefObject } from "react";
import { draftSaver } from "@scripta/shared";
import { Input } from "../../ui";
import { useDebouncedCallback } from "../library/lib/debounce";

const DRAFT_DELAY_MS = 600;

export function DraftField({ label, initial, max, onSave, flushRef }: { label: string; initial: string | null; max: number; onSave: (value: string | null) => Promise<boolean>; flushRef?: RefObject<() => void> }) {
  const [draft, setDraft] = useState(initial ?? "");
  const [save] = useState(() => draftSaver(initial, (failed, previous) => setDraft((current) => (current === failed ? (previous ?? "") : current))));
  const { schedule, flush } = useDebouncedCallback((value: string) => save(value, onSave), DRAFT_DELAY_MS);
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => { flushRef.current = () => {}; };
  });
  return <Input label={label} value={draft} maxLength={max} hint={`${draft.length}/${max}`} onChangeText={(value) => { setDraft(value); schedule(value); }} />;
}
