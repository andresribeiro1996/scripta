// "My tournaments" — list + a "+" tile. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.
// Tier lists live here too, behind the segmented tab control below —
// they're Arena-shaped content (pick books, rank them) even though a
// tier list itself renders inside a mural.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { contentDetail, contentTarget } from "@scripta/shared/community";
import type { Tierlist } from "../api/tierlists";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ArenaIcon } from "../components/NavIcons";
import { OptionsMenu } from "../components/OptionsMenu";
import { SkeletonCardGrid } from "../components/Skeleton";
import { PlusIcon, TOOLBAR_CONTROL_CLASS, ToolbarRow } from "../components/Toolbar";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useMyTournaments } from "../hooks/useMyTournaments";
import { useTierlists } from "../hooks/useTierlists";
import { useVotedTierlists } from "../hooks/useVotedTierlists";
import { useVotedTournaments } from "../hooks/useVotedTournaments";
import type { TournamentSummary } from "../api/arena";

export function ArenaListPage() {
  const { tournaments, isLoading } = useMyTournaments();
  const showSkeleton = useDelayedShow(isLoading);
  const { tournaments: votedTournaments } = useVotedTournaments();
  const { data: tierlistsData, isLoading: tierlistsLoading, rename, remove } = useTierlists();
  const showTierlistSkeleton = useDelayedShow(tierlistsLoading);
  const { tierlists: votedTierlists } = useVotedTierlists();
  const tierlists = tierlistsData ?? [];
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "tierlists" ? "tierlists" : "tournaments";
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [renamingTierlistId, setRenamingTierlistId] = useState<string | null>(null);
  const [tierlistNameDraft, setTierlistNameDraft] = useState("");

  function handleTabSwitch(next: "tournaments" | "tierlists") {
    const params = new URLSearchParams(searchParams);
    if (next === "tournaments") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params);
  }

  const bySearch = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
    return {
      created: tournaments.filter((t) => matches(t.name)),
      voted: votedTournaments.filter((t) => matches(t.name))
    };
  }, [tournaments, votedTournaments, search]);

  // Opens an UNSAVED tournament rather than POSTing one. Creating on
  // click left an "Untitled tournament" behind on every idle tap, and
  // silently fixed its bracket size at 16 — which cannot be changed
  // afterwards. The seed page now creates it on the first real change,
  // and offers the size picker until then.
  function handleCreate() {
    navigate("/dashboard/arena/new/seed");
  }

  async function handleRenameTierlist(tierlist: Tierlist) {
    const name = tierlistNameDraft.trim();
    setRenamingTierlistId(null);
    if (!name || name === tierlist.name) return;
    try {
      await rename(tierlist.id, name);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't save that name.");
    }
  }

  async function handleDeleteTierlist(tierlist: Tierlist) {
    if (!(await confirm({ title: `Delete "${tierlist.name}"?`, body: "This can't be undone." }))) return;
    await remove(tierlist.id);
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      {/* Desktop-only title, like the other list pages — the bottom tab
          bar already says where you are, and the search row below is
          what a phone actually needs at the top. */}
      <h2 className="mb-6 hidden text-lg font-bold sm:block">Games</h2>

      {/* The two Arena contents, one segmented control — same component
          shape ArenaViewPage's round control uses, so switching between
          tournaments and tier lists reads as the same gesture as
          switching rounds. */}
      <div className="mb-4 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) sm:w-72">
        {(["tournaments", "tierlists"] as const).map((t, i) => (
          <button
            key={t}
            onClick={() => handleTabSwitch(t)}
            aria-pressed={tab === t}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 text-sm font-semibold ${
              i > 0 ? "border-l border-(--color-border)" : ""
            } ${tab === t ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
          >
            {t === "tournaments" ? "Tournaments" : "Tier lists"}
          </button>
        ))}
      </div>

      {tab === "tournaments" && (
        <>
          <p className="mb-4 text-sm text-(--color-text-dim)">
            Bracket tournaments from your library —{" "}
            <a href="/arena" className="text-(--color-accent) underline">
              browse public tournaments
            </a>
            .
          </p>

          {(tournaments.length > 0 || votedTournaments.length > 0) && (
            <ToolbarRow>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                aria-label="Search tournaments by name"
                className={`${TOOLBAR_CONTROL_CLASS} w-full sm:max-w-xs`}
              />
            </ToolbarRow>
          )}

          {showSkeleton && <SkeletonCardGrid count={3} label="Loading tournaments" tileClassName="min-h-[86px]" />}

          {/* Section headers appear only once there's something in the
              second section — until then the tab is the plain create list
              it always was. */}
          {votedTournaments.length > 0 && <h3 className="mb-3 text-sm font-semibold">Created by you</h3>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Always first, always present — deliberately outside the map
                so creating never disappears when the list is empty, the same
                way the mural grid's "+" tile works. Opens an unsaved
                tournament on the seed page, where the name and bracket size
                are editable until the first real change saves it. */}
            <button
              onClick={handleCreate}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
            >
              <PlusIcon />
              <span className="text-sm font-semibold">New tournament</span>
            </button>

            {bySearch.created.map((t) => (
              <TournamentCard key={t.id} t={t} />
            ))}
          </div>

          {(bySearch.voted.length > 0 || (votedTournaments.length > 0 && !search.trim())) && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold">Voting in</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {bySearch.voted.map((t) => (
                  <TournamentCard key={t.id} t={t} />
                ))}
              </div>
            </>
          )}

          {(tournaments.length > 0 || votedTournaments.length > 0) && bySearch.created.length === 0 && bySearch.voted.length === 0 && (
            <p className="mt-4 text-sm text-(--color-text-dim)">Nothing matches “{search.trim()}”.</p>
          )}
        </>
      )}

      {tab === "tierlists" && (
        <>
          {createError && <p className="mb-4 text-sm text-(--color-danger)">{createError}</p>}

          {showTierlistSkeleton && <SkeletonCardGrid count={3} label="Loading tier lists" tileClassName="min-h-[86px]" />}

          {!tierlistsLoading && tierlists.length === 0 && votedTierlists.length === 0 && (
            <EmptyState
              icon={ArenaIcon}
              title="No tier lists yet."
              body="A tier list ranks your books into S/A/B… rows — build one and drop it into a mural."
            />
          )}

          {votedTierlists.length > 0 && <h3 className="mb-3 text-sm font-semibold">Created by you</h3>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              onClick={() => navigate("/dashboard/arena/tierlist/new")}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
            >
              <PlusIcon />
              <span className="text-sm font-semibold">New tier list</span>
            </button>

            {tierlists.map((tl) =>
              renamingTierlistId === tl.id ? (
                <div key={tl.id} className="rounded-xl border border-(--color-accent) bg-(--color-surface) p-4">
                  <input
                    autoFocus
                    value={tierlistNameDraft}
                    onChange={(e) => setTierlistNameDraft(e.target.value)}
                    onBlur={() => void handleRenameTierlist(tl)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRenameTierlist(tl);
                      if (e.key === "Escape") setRenamingTierlistId(null);
                    }}
                    aria-label="Tier list name"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 font-semibold"
                  />
                  <p className="mt-1 text-sm text-(--color-text-dim)">Updated {new Date(tl.updatedAt).toLocaleDateString()}</p>
                </div>
              ) : (
                <div
                  key={tl.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/dashboard/arena/tierlist/${tl.id}`)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                      e.preventDefault();
                      navigate(`/dashboard/arena/tierlist/${tl.id}`);
                    }
                  }}
                  className="relative cursor-pointer rounded-xl border border-(--color-border) bg-(--color-surface) hover:border-(--color-accent)"
                >
                  <div className="p-4 pr-12">
                    <h3 className="font-semibold">{tl.name}</h3>
                    <p className="text-sm text-(--color-text-dim)">Updated {new Date(tl.updatedAt).toLocaleDateString()}</p>
                  </div>
                  <OptionsMenu
                    title="Tier list settings"
                    triggerClassName="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                    items={[
                      ...(tl.voteCode === null ? [{
                        label: "Rename",
                        onClick: () => {
                          setTierlistNameDraft(tl.name);
                          setRenamingTierlistId(tl.id);
                        }
                      }] : []),
                      { label: "Delete", onClick: () => void handleDeleteTierlist(tl), danger: true }
                    ]}
                  />
                </div>
              )
            )}
          </div>

          {votedTierlists.length > 0 && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold">Voted on</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {votedTierlists.map((tl) => (
                  <a
                    key={tl.id}
                    href={contentTarget({ kind: "tierlist", ...tl })}
                    className="block rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)"
                  >
                    <h3 className="font-semibold">{tl.name}</h3>
                    <p className="text-sm text-(--color-text-dim)">{contentDetail({ kind: "tierlist", ...tl })}</p>
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Shared by both tournament sections — a voted tournament is never
// seeding, but the card markup is identical either way.
function TournamentCard({ t }: { t: TournamentSummary }) {
  return (
    <a
      href={t.status === "seeding" ? `/dashboard/arena/${t.id}/seed` : `/arena/${t.id}`}
      className="block rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)"
    >
      <h3 className="font-semibold">{t.name}</h3>
      <p className="flex flex-wrap items-center gap-1.5 text-sm text-(--color-text-dim)">
        {t.bracketSize}-book bracket
        <TournamentStatusBadge status={t.status} round={t.currentRound} />
      </p>
    </a>
  );
}
