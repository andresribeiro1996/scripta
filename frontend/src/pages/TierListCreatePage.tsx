import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { bookKey, createTier, DEFAULT_TIER_PRESET, type TierlistData } from "@scripta/shared";
import { PageContainer } from "../components/PageContainer";
import { useLibrary } from "../hooks/useLibrary";
import { useTierlists } from "../hooks/useTierlists";

export function TierListCreatePage() {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const books = library?.data.books ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = books.filter((book) => !needle || String(book.Title ?? "").toLowerCase().includes(needle) || String(book.Attribution ?? "").toLowerCase().includes(needle));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await create(name.trim() || "Untitled tier list", { tiers, pool }, visibility === "public" ? access : undefined);
      navigate(created.voteCode ? `/vote/${created.voteCode}` : `/dashboard/arena/tierlist/${created.id}`, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create the tier list.");
    } finally {
      setBusy(false);
    }
  }

  return <PageContainer>
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-10">
      <Link to="/dashboard/arena?tab=tierlists" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">← Tier lists</Link>
      <div>
        <p className="text-sm text-(--color-text-dim)">Step {step + 1} of 3</p>
        <h1 className="text-2xl font-bold">{["Choose books", "Set up tiers", "Publish settings"][step]}</h1>
      </div>
      {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}
      {step === 0 && <>
        <label className="flex flex-col gap-1 text-sm font-semibold">Tier list name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder="Untitled tier list" className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Books in pool · {pool.length}
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2" />
        </label>
        {isLoading ? <p>Loading books…</p> : isError ? <button onClick={() => void refetch()} className="text-left text-(--color-accent)">Couldn't load your library. Retry</button> : <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {filtered.map((book) => {
            const key = bookKey(book);
            const checked = pool.includes(key);
            return <button key={key} type="button" aria-pressed={checked} onClick={() => setPool((value) => checked ? value.filter((entry) => entry !== key) : [...value, key])} className={`flex min-h-12 w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${checked ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface)"}`}>
              <span className="truncate">{String(book.Title ?? "Untitled")}</span><span aria-hidden="true">{checked ? "✓" : "+"}</span>
            </button>;
          })}
          {!filtered.length && <p className="text-sm text-(--color-text-dim)">No books found.</p>}
        </div>}
      </>}
      {step === 1 && <>
        <p className="text-sm text-(--color-text-dim)">The S–D tiers are ready. Rename, remove, or add tiers.</p>
        {tiers.map((tier, index) => <div key={tier.id} className="flex items-end gap-3">
          <span className="mb-1 h-10 w-3 shrink-0 rounded" style={{ backgroundColor: tier.color }} />
          <label className="flex flex-1 flex-col gap-1 text-sm">Tier {index + 1}
            <input value={tier.label} maxLength={30} onChange={(event) => setTiers((value) => value.map((entry) => entry.id === tier.id ? { ...entry, label: event.target.value } : entry))} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2" />
          </label>
          <button type="button" disabled={tiers.length === 1} onClick={() => setTiers((value) => value.filter((entry) => entry.id !== tier.id))} className="min-h-10 rounded-lg border border-(--color-border) px-3 disabled:opacity-50">Remove</button>
        </div>)}
        <button type="button" onClick={() => setTiers((value) => [...value, createTier("New tier", "#8a8580")])} className="min-h-10 rounded-lg border border-(--color-border) px-3">Add tier</button>
      </>}
      {step === 2 && <>
        <fieldset className="flex flex-col gap-3"><legend className="mb-2 font-semibold">Visibility</legend>
          {(["private", "public"] as const).map((value) => <label key={value} className="flex items-center gap-2 rounded-lg border border-(--color-border) p-3"><input type="radio" checked={visibility === value} onChange={() => setVisibility(value)} />{value === "private" ? "Private" : "Public · open for voting"}</label>)}
        </fieldset>
        {visibility === "public" ? <>
          <fieldset className="flex flex-col gap-3"><legend className="mb-2 font-semibold">Who can vote?</legend>
            {(["anonymous", "members"] as const).map((value) => <label key={value} className="flex items-center gap-2 rounded-lg border border-(--color-border) p-3"><input type="radio" checked={access === value} onChange={() => setAccess(value)} />{value === "anonymous" ? "Anyone" : "Members only"}</label>)}
          </fieldset>
          <p className="text-sm text-(--color-text-dim)">Public lists lock their name, books, and tiers. At 100 distinct signed-in voters, this becomes an app-owned reference.</p>
        </> : <p className="text-sm text-(--color-text-dim)">Only you can see and edit this list. You can open voting later.</p>}
        <p className="text-sm text-(--color-text-dim)">{pool.length} {pool.length === 1 ? "book" : "books"} · {tiers.length} tiers</p>
      </>}
      <div className="flex justify-end gap-3 pt-2">
        {step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="min-h-11 rounded-lg border border-(--color-border) px-4">Back</button>}
        {step < 2 ? <button type="button" disabled={step === 0 ? !pool.length || isError : tiers.some((tier) => !tier.label.trim())} onClick={() => setStep((value) => value + 1)} className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50">Next</button> : <button type="button" disabled={busy} onClick={() => void submit()} className="min-h-11 rounded-lg bg-(--color-accent) px-4 font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Create tier list"}</button>}
      </div>
    </div>
  </PageContainer>;
}
