import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDiscover } from "../api/community";
import { fetchTopShelf } from "../api/topShelf";
import { fetchRecentAwards } from "../api/works";
import { useAuth } from "../auth/AuthContext";
import { DailyChapterCard } from "../components/dailyChapter/DailyChapterCard";
import { EmptyState } from "../components/EmptyState";
import { DiscoverTicket } from "../components/games/DiscoverTicket";
import { AwardsCard } from "../components/home/AwardsCard";
import { ReadingStrip } from "../components/home/ReadingStrip";
import { SuggestedReaders } from "../components/home/SuggestedReaders";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { SECTION_HEADING } from "../components/page/surfaceClasses";
import { useCircleFeed } from "../hooks/useDashboard";
import { useLibrary } from "../hooks/useLibrary";
import { homeGames } from "../lib/homeGames";

const SECTION_LINK = "inline-flex min-h-11 shrink-0 items-center font-semibold text-(--color-accent)";
const GROUP_LABEL = "mb-3 font-semibold text-(--color-text-dim)";

export function HomePage() {
  const { session } = useAuth();
  const library = useLibrary();
  const circle = useCircleFeed();
  const shelf = useQuery({ queryKey: ["topShelf", "month", null], queryFn: () => fetchTopShelf({ period: "month", genre: null }), staleTime: 30_000, retry: 1 });
  const awards = useQuery({ queryKey: ["recentAwards"], queryFn: fetchRecentAwards, staleTime: 30_000, retry: 1 });
  const viewerId = session?.user.id ?? "";
  const popular = shelf.data?.games ?? [];
  const settled = !circle.isLoading && !shelf.isPending;
  const picked = homeGames({ circle: circle.items, popular, newest: [], viewerId });
  const needsNewest = settled && picked.followed.length === 0 && picked.others.length === 0;
  const newest = useQuery({ queryKey: ["community", "discover", "home"], queryFn: () => fetchDiscover("all", "", 0), enabled: needsNewest, staleTime: 30_000, retry: 1 });
  const games = needsNewest ? homeGames({ circle: circle.items, popular, newest: newest.data?.items ?? [], viewerId }) : picked;
  const loadingGames = !settled || newest.isLoading;
  const noGames = games.followed.length === 0 && games.others.length === 0;
  const gamesFailed = noGames && (circle.isError || shelf.isError || newest.isError);
  const books = library.data?.data.books ?? [];
  const reading = books.filter((book) => book.ReadStatus === 1);

  return <Page title="Home">
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
      <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
        <DailyChapterCard />
        {awards.data ? <AwardsCard announcements={awards.data.announcements} library={library.data ?? null} /> : null}
        <section aria-labelledby="home-games">
          <div className="mb-3.5 flex items-baseline justify-between gap-3">
            <h2 id="home-games" className={SECTION_HEADING}>Games</h2>
            <Link to="/community/discover" className={SECTION_LINK}>Browse all →</Link>
          </div>
          {loadingGames ? <p role="status">Loading games…</p> : gamesFailed ? (
            <div role="alert" className="space-y-3">
              <p>Couldn't load games.</p>
              <button type="button" className={BUTTON_SECONDARY} onClick={() => { void circle.refetch(); void shelf.refetch(); void newest.refetch(); }}>Retry</button>
            </div>
          ) : noGames ? <p className="text-(--color-text-dim)">Nothing published yet. Games from readers show up here.</p> : (
            <div className="space-y-6">
              {games.followed.length > 0 ? <div>
                <p className={GROUP_LABEL}>From people you follow</p>
                <ul className="game-ticket-grid">{games.followed.map((item) => <DiscoverTicket key={`${item.content.kind}:${item.content.id}`} item={item} />)}</ul>
              </div> : null}
              {games.others.length > 0 ? <div>
                <p className={GROUP_LABEL}>{games.othersLabel}</p>
                <ul className="game-ticket-grid">{games.others.map((item) => <DiscoverTicket key={`${item.content.kind}:${item.content.id}`} item={item} />)}</ul>
              </div> : null}
            </div>
          )}
        </section>
      </div>
      <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        {library.isPending ? <p role="status">Loading your reading…</p> : library.isError ? (
          <div role="alert" className="space-y-3"><p>Couldn't load your library.</p><button type="button" className={BUTTON_SECONDARY} onClick={() => void library.refetch()}>Retry</button></div>
        ) : books.length === 0 ? (
          <EmptyState title="Start your library" body="Import your existing collection, or add your first book manually." action={<div className="flex flex-wrap justify-center gap-2"><Link className={BUTTON_PRIMARY} to="/dashboard/library?action=import">Import library</Link><Link className={BUTTON_SECONDARY} to="/dashboard/library?action=add">Add a book</Link></div>} />
        ) : <ReadingStrip books={reading} works={library.data?.works} />}
        <SuggestedReaders />
      </div>
      <section aria-labelledby="home-circle" className="min-w-0 lg:col-start-1 lg:row-start-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="home-circle" className={SECTION_HEADING}>Your reading circle</h2>
          <Link to="/community/people" className={SECTION_LINK}>Find people →</Link>
        </div>
      </section>
    </div>
  </Page>;
}
