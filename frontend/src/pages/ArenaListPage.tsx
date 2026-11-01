// "My tournaments" — list with a create button. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.
// Tier lists and quizzes live here too, behind the Games tabs in the
// band — they're Arena-shaped content (pick books, rank them) even though a
// tier list itself renders inside a mural.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { itemNoun, quizPreview, tierlistBookCount } from "@scripta/shared";
import { sharedT } from "@scripta/shared/i18n";
import { TIER_LADDER, ownedTierlistStatus, contentDetail, contentTarget, formatDate } from "@scripta/shared/community";
import type { Quiz } from "../api/quizzes";
import type { Tierlist } from "../api/tierlists";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
import { QuizStatusBadge, quizStatus } from "../components/quizzes/QuizStatusBadge";
import { GameTicket, StatusBadge } from "../components/games/GameTicket";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ArenaIcon } from "../components/NavIcons";
import { OptionsMenu } from "../components/OptionsMenu";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { SkeletonCardGrid } from "../components/Skeleton";
import { SearchField, ToolbarRow } from "../components/Toolbar";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useMyTournaments } from "../hooks/useMyTournaments";
import { useQuizzes } from "../hooks/useQuizzes";
import { useTierlists } from "../hooks/useTierlists";
import { useVotedTierlists } from "../hooks/useVotedTierlists";
import { useVotedTournaments } from "../hooks/useVotedTournaments";
import { area } from "../lib/areas";
import type { Tournament } from "../api/arena";
import { useLocale, useT } from "../i18n";

export function ArenaListPage() {
  const locale = useLocale();
  const t = useT();
  const shared = sharedT(locale);
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
      created: tournaments.filter((tournament) => matches(tournament.name)),
      voted: votedTournaments.filter((tournament) => matches(tournament.name))
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
      setCreateError(err instanceof Error ? err.message : t("arena.couldntSaveName"));
    }
  }

  async function handleDeleteTierlist(tierlist: Tierlist) {
    if (!(await confirm({ title: t("arena.deleteTitle", { name: tierlist.name }), body: t("library.cannotUndo") }))) return;
    await remove(tierlist.id);
  }

  async function handleDeleteQuiz(quiz: Quiz) {
    if (!(await confirm({ title: t("arena.deleteTitle", { name: quiz.name }), body: t("library.cannotUndo") }))) return;
    await removeQuiz(quiz.id);
  }

  const create =
    tab === "tierlists"
      ? { label: t("arena.newTierList"), onClick: () => navigate("/dashboard/arena/tierlist/new") }
      : tab === "quizzes"
        ? { label: t("arena.newQuiz"), onClick: () => navigate("/dashboard/arena/quiz/new") }
        : { label: t("arena.newTournament"), onClick: handleCreate };

  const [subtitleBefore, subtitleAfter] = t("arena.listSubtitle").split("{link}");

  return (
    <Page
      width="wide"
      title={t("shell.areaGames")}
      subtitle={
        <>
          {subtitleBefore}
          <a href="/arena" className="inline-flex min-h-11 items-center text-(--color-accent) underline">
            {t("arena.browsePublicGames")}
          </a>
          {subtitleAfter}
        </>
      }
      tabs={area("games").tabs}
      reserveSubtitle
      actions={
        <button onClick={create.onClick} className={BUTTON_PRIMARY}>
          {create.label}
        </button>
      }
    >
      {tab === "tournaments" && (
        <>
          {(tournaments.length > 0 || votedTournaments.length > 0) && (
            <ToolbarRow>
              <SearchField value={search} onChange={setSearch} placeholder={t("library.search")} label={t("arena.searchTournaments")} />
            </ToolbarRow>
          )}

          {showSkeleton && <SkeletonCardGrid count={3} label={t("arena.loadingTournaments")} tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}

          {!isLoading && !votedLoading && loadError && (
            <EmptyState
              title={t("arena.loadTournamentsFailed")}
              action={
                <button onClick={() => void Promise.all([refetchTournaments(), refetchVoted()])} className={BUTTON_SECONDARY}>
                  {t("library.retry")}
                </button>
              }
            />
          )}

          {!isLoading && !votedLoading && !loadError && tournaments.length === 0 && votedTournaments.length === 0 && (
            <EmptyState icon={ArenaIcon} title={t("arena.noTournaments")} body={t("arena.noTournamentsBody")} />
          )}

          {votedTournaments.length > 0 && <h3 className="mb-3 text-sm font-semibold">{t("arena.createdByYou")}</h3>}

          <div className="game-ticket-grid">
            {bySearch.created.map((tournament) => (
              <TournamentCard key={tournament.id} tournament={tournament} />
            ))}
          </div>

          {(bySearch.voted.length > 0 || (votedTournaments.length > 0 && !search.trim())) && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold">{t("arena.votingIn")}</h3>
              <div className="game-ticket-grid">
                {bySearch.voted.map((tournament) => (
                  <TournamentCard key={tournament.id} tournament={tournament} />
                ))}
              </div>
            </>
          )}

          {(tournaments.length > 0 || votedTournaments.length > 0) && bySearch.created.length === 0 && bySearch.voted.length === 0 && (
            <p className="mt-4 text-sm text-(--color-text-dim)">{t("arena.nothingMatches", { search: search.trim() })}</p>
          )}
        </>
      )}

      {tab === "tierlists" && (
        <>
          {createError && <p className="mb-4 text-sm text-(--color-danger)">{createError}</p>}

          {showTierlistSkeleton && <SkeletonCardGrid count={3} label={t("arena.loadingTierlists")} tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}

          {!tierlistsLoading && tierlists.length === 0 && votedTierlists.length === 0 && (
            <EmptyState
              icon={ArenaIcon}
              title={t("arena.noTierlists")}
              body={t("arena.noTierlistsBody")}
            />
          )}

          {votedTierlists.length > 0 && <h3 className="mb-3 text-sm font-semibold">{t("arena.createdByYou")}</h3>}

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
                    aria-label={t("arena.tierlistName")}
                    className={`${FIELD_CLASS} w-full font-semibold`}
                  />
                  <p className="mt-1 text-sm text-(--color-text-dim)">{t("arena.updated", { date: formatDate(tl.updatedAt, locale) })}</p>
                </div>
              ) : (
                <GameTicket
                  key={tl.id}
                  kind="tierlist"
                  name={tl.name}
                  to={`/dashboard/arena/tierlist/${tl.id}`}
                  meta={t("arena.updated", { date: formatDate(tl.updatedAt, locale) })}
                  badges={<StatusBadge {...ownedTierlistStatus(tl, locale)} />}
                  stats={[{ value: tierlistBookCount(tl.data), label: itemNoun(tl.subject, tierlistBookCount(tl.data), locale) }]}
                  covers={tl.subject?.scope.coverUrl ? [tl.subject.scope.coverUrl] : []}
                  ladder={tl.data.tiers.map((tier) => tier.color)}
                  play={tl.voteCode === null ? undefined : { to: `/vote/${tl.voteCode}`, label: t("arena.preview") }}
                  menu={
                    <OptionsMenu
                      title={t("arena.tierlistSettings")}
                      triggerClassName={"flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"}
                      items={[
                        ...(tl.voteCode === null ? [{
                          label: t("library.groupRename"),
                          onClick: () => {
                            setTierlistNameDraft(tl.name);
                            setRenamingTierlistId(tl.id);
                          }
                        }] : []),
                        { label: t("shell.delete"), onClick: () => void handleDeleteTierlist(tl), danger: true }
                      ]}
                    />
                  }
                />
              )
            )}
          </div>

          {votedTierlists.length > 0 && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold">{t("arena.votedOn")}</h3>
              <div className="game-ticket-grid">
                {votedTierlists.map((tl) => (
                  <GameTicket
                    key={tl.id}
                    kind="tierlist"
                    name={tl.name}
                    to={contentTarget({ kind: "tierlist", ...tl })}
                    meta={contentDetail({ kind: "tierlist", ...tl }, locale)}
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
          {showQuizSkeleton && <SkeletonCardGrid count={3} label={t("arena.loadingQuizzes")} tileClassName="min-h-[260px]" gridClassName="game-ticket-grid" />}

          {!quizzesLoading && quizzes.length === 0 && (
            <EmptyState
              icon={ArenaIcon}
              title={t("arena.noQuizzes")}
              body={t("arena.noQuizzesBody")}
            />
          )}

          <div className="game-ticket-grid auto-rows-fr">
            {quizzes.map((quiz) => (
              <GameTicket
                key={quiz.id}
                kind="quiz"
                name={quiz.name}
                to={`/dashboard/arena/quiz/${quiz.id}`}
                meta={shared("shared.helpers.books", { count: quiz.data.books.length })}
                badges={<QuizStatusBadge status={quizStatus(quiz)} />}
                stats={[{ value: quiz.data.questionCount, label: shared("shared.helpers.questionNoun", { count: quiz.data.questionCount }) }]}
                covers={[]}
                preview={quizPreview(quiz.data)}
                menu={
                  <OptionsMenu
                    title={t("arena.quizSettings")}
                    triggerClassName={"flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"}
                    items={[{ label: t("shell.delete"), onClick: () => void handleDeleteQuiz(quiz), danger: true }]}
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
function TournamentCard({ tournament }: { tournament: Tournament }) {
  const locale = useLocale();
  const t = useT();
  return (
    <GameTicket
      kind="tournament"
      name={tournament.name}
      to={tournament.status === "seeding" ? `/dashboard/arena/${tournament.id}/seed` : `/arena/${tournament.id}`}
      meta={t("arena.created", { date: formatDate(tournament.createdAt, locale) })}
      badges={<TournamentStatusBadge status={tournament.status} round={tournament.currentRound} />}
      stats={[{ value: tournament.bracketSize, label: itemNoun(tournament.subject, tournament.bracketSize, locale) }]}
      covers={tournament.covers}
    />
  );
}
