// "My tournaments" — list with a create button. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.
// Tier lists and quizzes live here too, behind the Games tabs in the
// band — they're Arena-shaped content (pick books, rank them) even though a
// tier list itself renders inside a mural.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { itemNoun, quizPreview } from "@scripta/shared";
import { TIER_LADDER, contentDetail, contentTarget } from "@scripta/shared/community";
import type { Quiz } from "../api/quizzes";
import type { Tierlist } from "../api/tierlists";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
import { QuizStatusBadge, quizStatus } from "../components/quizzes/QuizStatusBadge";
import { GameTicket } from "../components/games/GameTicket";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ArenaIcon } from "../components/NavIcons";
import { OptionsMenu } from "../components/OptionsMenu";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { SkeletonCardGrid } from "../components/Skeleton";
import { ToolbarRow } from "../components/Toolbar";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useMyTournaments } from "../hooks/useMyTournaments";
import { useQuizzes } from "../hooks/useQuizzes";
import { useTierlists } from "../hooks/useTierlists";
import { useVotedTierlists } from "../hooks/useVotedTierlists";
import { useVotedTournaments } from "../hooks/useVotedTournaments";
import { area } from "../lib/areas";
import type { Tournament } from "../api/arena";

export function ArenaListPage() {
  const { tournaments, isLoading, error: tournamentsError, refetch: refetchTournaments } = useMyTournaments();
  const showSkeleton = useDelayedShow(isLoading);
  const { tournaments: votedTournaments, isLoading: votedLoading, error: votedError, refetch: refetchVoted } = useVotedTournaments();
  const loadError = tournamentsError || votedError;
  const { data: quizzesData, isLoading: quizzesLoading, remove: removeQuiz } = useQuizzes();
  const quizzes = quizzesData ?? [];
  const showQuizSkeleton = useDelayedShow(quizzesLoading);
  const { data: tierlistsData, isLoading: tierlistsLoading, rename, remove } = useTierlists();
  const showTierlistSkeleton = useDelayedShow(tierlistsLoading);
  const { tierlists: votedTierlists } = useVotedTierlists();
  const tierlists = tierlistsData ?? [];
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "tierlists" ? "tierlists" : searchParams.get("tab") === "quizzes" ? "quizzes" : "tournaments";
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [renamingTierlistId, setRenamingTierlistId] = useState<string | null>(null);
  const [tierlistNameDraft, setTierlistNameDraft] = useState("");

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

  async function handleDeleteQuiz(quiz: Quiz) {
    if (!(await confirm({ title: `Delete "${quiz.name}"?`, body: "This can't be undone." }))) return;
    await removeQuiz(quiz.id);
  }

  const create =
    tab === "tierlists"
      ? { label: "New tier list", onClick: () => navigate("/dashboard/arena/tierlist/new") }
      : tab === "quizzes"
        ? { label: "New quiz", onClick: () => navigate("/dashboard/arena/quiz/new") }
        : { label: "New tournament", onClick: handleCreate };

  return (
    <Page
      title="Games"
      tabs={area("games").tabs}
      actions={
        <button onClick={create.onClick} className={BUTTON_PRIMARY}>
          {create.label}
        </button>
      }
    >
      {tab === "tournaments" && (
        <>
          <p className="mb-4 text-sm text-(--color-text-dim)">
            Bracket tournaments from your library —{" "}
            <a href="/arena" className="inline-flex min-h-11 items-center text-(--color-accent) underline">
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
                className={`${FIELD_CLASS} w-full sm:max-w-xs`}
              />
            </ToolbarRow>
          )}

          {showSkeleton && <SkeletonCardGrid count={3} label="Loading tournaments" tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}

          {!isLoading && !votedLoading && loadError && (
            <EmptyState
              title="Couldn't load your tournaments."
              action={
                <button onClick={() => void Promise.all([refetchTournaments(), refetchVoted()])} className={BUTTON_SECONDARY}>
                  Retry
                </button>
              }
            />
          )}

          {!isLoading && !votedLoading && !loadError && tournaments.length === 0 && votedTournaments.length === 0 && (
            <EmptyState icon={ArenaIcon} title="No tournaments yet." body="Pit your books against each other in a bracket." />
          )}

          {votedTournaments.length > 0 && <h3 className="mb-3 text-sm font-semibold">Created by you</h3>}

          <div className="game-ticket-grid">
            {bySearch.created.map((t) => (
              <TournamentCard key={t.id} t={t} />
            ))}
          </div>

          {(bySearch.voted.length > 0 || (votedTournaments.length > 0 && !search.trim())) && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold">Voting in</h3>
              <div className="game-ticket-grid">
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

          {showTierlistSkeleton && <SkeletonCardGrid count={3} label="Loading tier lists" tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}

          {!tierlistsLoading && tierlists.length === 0 && votedTierlists.length === 0 && (
            <EmptyState
              icon={ArenaIcon}
              title="No tier lists yet."
              body="A tier list ranks your books into S/A/B… rows — build one and drop it into a mural."
            />
          )}

          {votedTierlists.length > 0 && <h3 className="mb-3 text-sm font-semibold">Created by you</h3>}

          <div className="game-ticket-grid">
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
                <GameTicket
                  key={tl.id}
                  kind="tierlist"
                  name={tl.name}
                  to={`/dashboard/arena/tierlist/${tl.id}`}
                  meta={`Updated ${new Date(tl.updatedAt).toLocaleDateString()}`}
                  badges={null}
                  covers={tl.subject?.scope.coverUrl ? [tl.subject.scope.coverUrl] : []}
                  ladder={tl.data.tiers.map((tier) => tier.color)}
                  menu={
                    <OptionsMenu
                      title="Tier list settings"
                      triggerClassName={"flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"}
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
                  }
                />
              )
            )}
          </div>

          {votedTierlists.length > 0 && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold">Voted on</h3>
              <div className="game-ticket-grid">
                {votedTierlists.map((tl) => (
                  <GameTicket
                    key={tl.id}
                    kind="tierlist"
                    name={tl.name}
                    to={contentTarget({ kind: "tierlist", ...tl })}
                    meta={contentDetail({ kind: "tierlist", ...tl })}
                    badges={null}
                    covers={tl.covers}
                    ladder={TIER_LADDER}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === "quizzes" && (
        <>
          {showQuizSkeleton && <SkeletonCardGrid count={3} label="Loading quizzes" tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}

          {!quizzesLoading && quizzes.length === 0 && (
            <EmptyState
              icon={ArenaIcon}
              title="No quizzes yet."
              body="A quiz turns your books into trivia — guess the title from a blurred cover, or the book from a famous line."
            />
          )}

          <div className="game-ticket-grid auto-rows-fr">
            {quizzes.map((quiz) => (
              <GameTicket
                key={quiz.id}
                kind="quiz"
                name={quiz.name}
                to={`/dashboard/arena/quiz/${quiz.id}`}
                meta={`${quiz.data.books.length} books`}
                badges={<QuizStatusBadge status={quizStatus(quiz)} />}
                covers={[]}
                preview={quizPreview(quiz.data)}
                menu={
                  <OptionsMenu
                    title="Quiz settings"
                    triggerClassName={"flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"}
                    items={[{ label: "Delete", onClick: () => void handleDeleteQuiz(quiz), danger: true }]}
                  />
                }
              />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

// Shared by both tournament sections — a voted tournament is never
// seeding, but the card markup is identical either way.
function TournamentCard({ t }: { t: Tournament }) {
  return (
    <GameTicket
      kind="tournament"
      name={t.name}
      to={t.status === "seeding" ? `/dashboard/arena/${t.id}/seed` : `/arena/${t.id}`}
      meta={`${t.bracketSize}-${itemNoun(t.subject, 1)} bracket`}
      badges={<TournamentStatusBadge status={t.status} round={t.currentRound} />}
      covers={t.covers}
    />
  );
}
