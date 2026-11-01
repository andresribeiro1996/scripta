import { readSavedBlockLooks, saveBlockLook, savedBlockLooksKey, type BlockStyle, type SavedBlockLook } from "@scripta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { FIELD_CLASS } from "../page/buttonClasses";
import { useLocale, useT } from "../../i18n";

export function SavedLooks({ style, onApply }: { style: BlockStyle; onApply: (style: BlockStyle) => void }) {
  const locale = useLocale();
  const t = useT();
  const { session } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const queryKey = ["mural-block-looks", session?.user.id];
  const key = savedBlockLooksKey(session?.user.id ?? "");
  const looks = useQuery({ queryKey, queryFn: () => readSavedBlockLooks(localStorage.getItem(key), locale), enabled: !!session, retry: false });
  const save = useMutation({
    mutationFn: async (next: SavedBlockLook[]) => { localStorage.setItem(key, JSON.stringify(next)); return next; },
    onSuccess: (next) => { client.setQueryData(queryKey, next); setName(""); },
  });
  const ready = !!session && looks.isSuccess && !looks.isFetching && !save.isPending;
  const button = "min-h-11 rounded-lg border border-(--color-border) px-3 py-2 text-sm hover:bg-(--color-surface-hover) disabled:opacity-50";
  return <section className="space-y-3 rounded-xl border border-(--color-border) p-4 sm:col-span-2">
    <h4 className="text-sm font-semibold">{t("muralEditor.savedLooks")}</h4>
    <p className="text-xs text-(--color-text-dim)">{t("muralEditor.savedLooksNote")}</p>
    {looks.isPending ? <p className="text-xs">{t("muralEditor.loadingLooks")}</p> : null}
    {looks.isError ? <div role="alert" className="text-sm text-(--color-danger)">{t("muralEditor.couldNotLoadLooks")} <button className={button} onClick={() => { void looks.refetch(); }}>{t("library.retry")}</button></div> : null}
    {(looks.data ?? []).map((look) => <div key={look.name} className="flex items-center gap-2">
      <button className={`${button} flex-1 text-left`} disabled={!ready} onClick={() => onApply({ ...look.style, cardBorderSides: { ...look.style.cardBorderSides } })}>{look.name}</button>
      <button className={button} aria-label={t("muralEditor.deleteLook", { name: look.name })} disabled={!ready} onClick={() => save.mutate(looks.data!.filter((item) => item.name !== look.name))}>{t("shell.delete")}</button>
    </div>)}
    <form onSubmit={(event) => { event.preventDefault(); if (ready && name.trim()) save.mutate(saveBlockLook(looks.data!, name, style, locale)); }} className="flex flex-wrap items-end gap-2">
      <label className="flex-1 text-sm font-semibold">{t("muralEditor.lookName")}<input className={`${FIELD_CLASS} mt-1 block w-full font-normal`} value={name} onChange={(event) => setName(event.target.value)} maxLength={48} placeholder={t("muralEditor.lookNamePlaceholder")} /></label>
      <button className={button} disabled={!ready || !name.trim()}>{t("muralEditor.saveCurrentLook")}</button>
    </form>
    {save.isError ? <p role="alert" className="text-sm text-(--color-danger)">{t("muralEditor.couldNotSaveLooks")}</p> : null}
  </section>;
}
