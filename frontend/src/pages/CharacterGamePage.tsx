import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bracketSizes, canCreate, defaultTicked, plural, type CharacterGameMode, type WorkCast } from "@scripta/shared";
import { createCharacterTournament } from "../api/arena";
import { createCharacterTierlist, type Tierlist } from "../api/tierlists";
import { fetchWorkCast } from "../api/works";
import { CoverImage } from "../components/BookCard";
import { LibraryIcon } from "../components/NavIcons";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../components/page/buttonClasses";

const MODES = [{ value: "tierlist", label: "Tier list" }, { value: "tournament", label: "Tournament" }] as const;
const inputClass = "min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2";

export function CharacterGamePage() {
  const { id = "" } = useParams<{ id: string }>();
  const cast = useQuery({ queryKey: ["works", id, "cast"], queryFn: () => fetchWorkCast(id), retry: false });
  return (
    <Page title="Character game" back={{ to: `/work/${id}`, label: "Book" }}>
      <div className="mx-auto max-w-2xl pb-10">
        {cast.isPending ? <p>Loading…</p> : cast.isError ? <button type="button" onClick={() => void cast.refetch()} className="min-h-11 text-left text-(--color-accent)">The cast couldn't be loaded. Retry</button> : <CastPicker key={id} workId={id} cast={cast.data} />}
      </div>
    </Page>
  );
}

function CastPicker({ workId, cast }: { workId: string; cast: WorkCast }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sizes = bracketSizes(cast.characters.length);
  const modes = sizes.length > 0 ? MODES : MODES.slice(0, 1);
  const [mode, setMode] = useState<CharacterGameMode>("tierlist");
  const [size, setSize] = useState(sizes[sizes.length - 1] ?? 0);
  const [ticked, setTicked] = useState(() => defaultTicked(cast.characters, "tierlist", size));
  const [name, setName] = useState(`${cast.scope.label} characters`);
  const [duration, setDuration] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = new Set(ticked);

  function chooseMode(next: CharacterGameMode) {
    setMode(next);
    setTicked(defaultTicked(cast.characters, next, size));
  }

  function chooseSize(next: number) {
    setSize(next);
    setTicked(defaultTicked(cast.characters, "tournament", next));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const characters = { workId, characterIds: ticked };
      const title = name.trim() || `${cast.scope.label} characters`;
      if (mode === "tierlist") {
        const created = await createCharacterTierlist(title, characters);
        queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => [...items, created]);
        navigate(`/dashboard/arena/tierlist/${created.id}`, { replace: true });
      } else {
        const hours = Number(duration);
        const created = await createCharacterTournament({ name: title, bracketSize: size, roundDurationMinutes: Number.isFinite(hours) && hours > 0 ? hours * 60 : 1440, characters });
        void queryClient.invalidateQueries({ queryKey: ["arenas", "mine"] });
        navigate(`/arena/${created.id}`, { replace: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create the game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}
      <div className="flex items-center gap-3">
        <div className="relative flex h-18 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-(--color-border)">
          {cast.scope.coverUrl ? <CoverImage book={{ _coverUrl: cast.scope.coverUrl }} fit="contain" alt={cast.scope.label} /> : <LibraryIcon size={22} />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold">{cast.scope.label}</p>
          {cast.scope.kind === "series" && <p className="text-sm text-(--color-text-dim)">{plural(cast.scope.workCount, "book", "books")}</p>}
        </div>
      </div>
      {modes.length > 1 && (
        <div role="group" aria-label="Game type" className="flex gap-2">
          {modes.map((option) => <button key={option.value} type="button" aria-pressed={mode === option.value} onClick={() => chooseMode(option.value)} className={mode === option.value ? BUTTON_PRIMARY : BUTTON_SECONDARY}>{option.label}</button>)}
        </div>
      )}
      {mode === "tournament" && (
        <>
          <div role="group" aria-label="Bracket size" className="flex flex-wrap gap-2">
            {sizes.map((value) => <button key={value} type="button" aria-pressed={size === value} onClick={() => chooseSize(value)} className={size === value ? BUTTON_PRIMARY : BUTTON_SECONDARY}>{value}</button>)}
          </div>
          <label className="flex flex-col gap-1 text-sm font-semibold">Round duration (hours)
            <input inputMode="decimal" value={duration} onChange={(event) => setDuration(event.target.value)} className={inputClass} />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold">Name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} className={inputClass} />
      </label>
      <p className="text-sm text-(--color-text-dim)">{mode === "tournament" ? `${ticked.length} of ${size} characters` : `${ticked.length} characters`}</p>
      <div className="space-y-2">
        {cast.characters.map((character) => {
          const checked = selected.has(character.id);
          return (
            <button key={character.id} type="button" aria-pressed={checked} onClick={() => setTicked((value) => checked ? value.filter((entry) => entry !== character.id) : [...value, character.id])} className={`flex min-h-12 w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${checked ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) bg-(--color-surface)"}`}>
              <span className="truncate">{character.name}</span><span aria-hidden="true">{checked ? "✓" : "+"}</span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-end">
        <button type="button" disabled={busy || !canCreate(mode, ticked.length, size)} onClick={() => void create()} className={BUTTON_PRIMARY}>{busy ? "Creating…" : mode === "tierlist" ? "Create tier list" : "Create tournament"}</button>
      </div>
    </div>
  );
}
