import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTier, DEFAULT_TIER_PRESET, workIdOf, type TierlistData, booksByWork } from "@scripta/shared";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { backTo } from "../lib/areas";
import { useLibrary } from "../hooks/useLibrary";
import { useTierlists } from "../hooks/useTierlists";
import { useWorkBooks } from "../hooks/useWorkBooks";
import { RADIO_CLASS, SearchField } from "../components/Toolbar";
import { useT } from "../i18n";

export function TierListCreatePage() {
  const t = useT();
  const navigate = useNavigate();
  const { data: library, isLoading, isError, refetch } = useLibrary();
  const { create } = useTierlists();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [pool, setPool] = useState<string[]>([]);
  const [tiers, setTiers] = useState<TierlistData["tiers"]>(() => DEFAULT_TIER_PRESET.map((tier) => createTier(tier.label, tier.color)));
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [access, setAccess] = useState<"anonymous" | "members">("anonymous");
  const [worstFirst, setWorstFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workBooks = useWorkBooks(library);
  const books = useMemo(() => [...booksByWork(workBooks).values()], [workBooks]);
  const needle = search.trim().toLowerCase();
  const filtered = books.filter((book) => !needle || String(book.Title ?? "").toLowerCase().includes(needle) || String(book.Attribution ?? "").toLowerCase().includes(needle));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await create(name.trim() || t("tierlists.untitled"), { tiers, pool }, visibility === "public" ? access : undefined, worstFirst);
      navigate(created.voteCode ? `/vote/${created.voteCode}` : `/dashboard/arena/tierlist/${created.id}`, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("tierlists.couldntCreate"));
    } finally {
      setBusy(false);
    }
  }

  return <Page width="narrow" title={[t("tierlists.stepChooseBooks"), t("tierlists.stepSetUpTiers"), t("tierlists.stepPublishSettings")][step]} subtitle={t("tierlists.stepOf", { step: step + 1 })} back={backTo("tierlist")}>
    <div className="flex flex-col gap-5 pb-10">
      {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}
      {step === 0 && <>
        <label className="flex flex-col gap-1 text-sm font-semibold">{t("arena.tierlistName")}
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder={t("tierlists.untitled")} className={FIELD_CLASS} />
        </label>
        <div className="flex flex-col gap-1 text-sm font-semibold">{t("tierlists.booksInPool", { count: pool.length })}
          <SearchField fill value={search} onChange={setSearch} placeholder={t("library.searchYourLibrary")} label={t("library.searchYourLibrary")} />
        </div>
        {isLoading ? <p>{t("tierlists.loadingBooks")}</p> : isError ? <button onClick={() => void refetch()} className="min-h-11 text-left text-(--color-accent)">{t("tierlists.libraryLoadRetry")}</button> : <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {filtered.map((book) => {
            const key = workIdOf(book)!;
            const checked = pool.includes(key);
            return <button key={key} type="button" aria-pressed={checked} onClick={() => setPool((value) => checked ? value.filter((entry) => entry !== key) : [...value, key])} className={`flex min-h-12 w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${checked ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface)"}`}>
              <span className="truncate">{String(book.Title ?? t("library.untitled"))}</span><span aria-hidden="true">{checked ? "✓" : "+"}</span>
            </button>;
          })}
          {!filtered.length && <p className="text-sm text-(--color-text-dim)">{t("tierlists.noBooksFound")}</p>}
        </div>}
      </>}
      {step === 1 && <>
        <p className="text-sm text-(--color-text-dim)">{t("tierlists.tiersReady")}</p>
        {tiers.map((tier, index) => <div key={tier.id} className="flex items-end gap-3">
          <span className="mb-1 h-10 w-3 shrink-0 rounded" style={{ backgroundColor: tier.color }} />
          <label className="flex flex-1 flex-col gap-1 text-sm">{t("tierlists.tierNumber", { number: index + 1 })}
            <input value={tier.label} maxLength={30} onChange={(event) => setTiers((value) => value.map((entry) => entry.id === tier.id ? { ...entry, label: event.target.value } : entry))} className={FIELD_CLASS} />
          </label>
          <button type="button" disabled={tiers.length === 1} onClick={() => setTiers((value) => value.filter((entry) => entry.id !== tier.id))} className={BUTTON_SECONDARY}>{t("arena.remove")}</button>
        </div>)}
        <button type="button" onClick={() => setTiers((value) => [...value, createTier(t("tierlists.newTier"), "#8a8580")])} className={BUTTON_SECONDARY}>{t("tierlists.addTier")}</button>
      </>}
      {step === 2 && <>
        <fieldset className="flex flex-col gap-3"><legend className="mb-2 font-semibold">{t("tierlists.topTierMeans")}</legend>
          {([false, true] as const).map((value) => <label key={String(value)} className="flex items-center gap-1 rounded-lg border border-(--color-border) pr-3"><input type="radio" className={RADIO_CLASS} name="direction" checked={worstFirst === value} onChange={() => setWorstFirst(value)} />{value ? t("tierlists.worst") : t("tierlists.best")}</label>)}
          <p className="text-sm text-(--color-text-dim)">{t("tierlists.cantChangeLater")}</p>
        </fieldset>
        <fieldset className="flex flex-col gap-3"><legend className="mb-2 font-semibold">{t("tierlists.visibility")}</legend>
          {(["private", "public"] as const).map((value) => <label key={value} className="flex items-center gap-1 rounded-lg border border-(--color-border) pr-3"><input type="radio" className={RADIO_CLASS} checked={visibility === value} onChange={() => setVisibility(value)} />{value === "private" ? t("library.private") : t("tierlists.publicOpen")}</label>)}
        </fieldset>
        {visibility === "public" ? <>
          <fieldset className="flex flex-col gap-3"><legend className="mb-2 font-semibold">{t("tierlists.whoCanVote")}</legend>
            {(["anonymous", "members"] as const).map((value) => <label key={value} className="flex items-center gap-1 rounded-lg border border-(--color-border) pr-3"><input type="radio" className={RADIO_CLASS} checked={access === value} onChange={() => setAccess(value)} />{value === "anonymous" ? t("tierlists.anyone") : t("tierlists.membersOnly")}</label>)}
          </fieldset>
          <p className="text-sm text-(--color-text-dim)">{t("tierlists.publicLocks")}</p>
        </> : <p className="text-sm text-(--color-text-dim)">{t("tierlists.privateNote")}</p>}
        <p className="text-sm text-(--color-text-dim)">{t("tierlists.bookCount", { count: pool.length })} · {t("tierlists.tierCount", { count: tiers.length })}</p>
      </>}
      <div className="flex justify-end gap-3 pt-2">
        {step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className={BUTTON_SECONDARY}>{t("tierlists.back")}</button>}
        {step < 2 ? <button type="button" disabled={step === 0 ? !pool.length || isError : tiers.some((tier) => !tier.label.trim())} onClick={() => setStep((value) => value + 1)} className={BUTTON_PRIMARY}>{t("tierlists.next")}</button> : <button type="button" disabled={busy} onClick={() => void submit()} className={BUTTON_PRIMARY}>{busy ? t("arena.creating") : t("arena.createTierlist")}</button>}
      </div>
    </div>
  </Page>;
}
