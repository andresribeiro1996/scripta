import { readSavedBlockLooks, saveBlockLook, savedBlockLooksKey, type BlockStyle, type SavedBlockLook } from "@scripta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";

export function SavedLooks({ style, onApply }: { style: BlockStyle; onApply: (style: BlockStyle) => void }) {
  const { session } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const queryKey = ["mural-block-looks", session?.user.id];
  const key = savedBlockLooksKey(session?.user.id ?? "");
  const looks = useQuery({ queryKey, queryFn: () => readSavedBlockLooks(localStorage.getItem(key)), enabled: !!session, retry: false });
  const save = useMutation({
    mutationFn: async (next: SavedBlockLook[]) => { localStorage.setItem(key, JSON.stringify(next)); return next; },
    onSuccess: (next) => { client.setQueryData(queryKey, next); setName(""); },
  });
  const ready = !!session && looks.isSuccess && !looks.isFetching && !save.isPending;
  const button = "min-h-11 rounded-lg border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-hover) disabled:opacity-50";
  return <section className="space-y-3 rounded-xl border border-(--color-border) p-4 sm:col-span-2">
    <h4 className="text-sm font-semibold">Saved looks</h4>
    <p className="text-xs text-(--color-text-dim)">Saved in this browser for your account. The same name replaces a look.</p>
    {looks.isPending ? <p className="text-xs">Loading looks…</p> : null}
    {looks.isError ? <div role="alert" className="text-sm text-(--color-danger)">Could not load saved looks. <button className={button} onClick={() => { void looks.refetch(); }}>Retry</button></div> : null}
    {(looks.data ?? []).map((look) => <div key={look.name} className="flex items-center gap-2">
      <button className={`${button} flex-1 text-left`} disabled={!ready} onClick={() => onApply({ ...look.style, cardBorderSides: { ...look.style.cardBorderSides } })}>{look.name}</button>
      <button className={button} aria-label={`Delete ${look.name}`} disabled={!ready} onClick={() => save.mutate(looks.data!.filter((item) => item.name !== look.name))}>Delete</button>
    </div>)}
    <form onSubmit={(event) => { event.preventDefault(); if (ready && name.trim()) save.mutate(saveBlockLook(looks.data!, name, style)); }} className="flex flex-wrap items-end gap-2">
      <label className="flex-1 text-sm font-semibold">Look name<input className="mt-1 block min-h-11 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 font-normal" value={name} onChange={(event) => setName(event.target.value)} maxLength={48} placeholder="My reading corner" /></label>
      <button className={button} disabled={!ready || !name.trim()}>Save current look</button>
    </form>
    {save.isError ? <p role="alert" className="text-sm text-(--color-danger)">Could not save looks. Try again.</p> : null}
  </section>;
}
