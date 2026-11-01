import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDiscover } from "../api/community";
import { fetchTopShelf } from "../api/topShelf";
import { fetchRecentAwards } from "../api/works";
import { useAuth } from "../auth/AuthContext";
import { DailyChapterCard } from "../components/dailyChapter/DailyChapterCard";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { DiscoverTicket } from "../components/games/DiscoverTicket";
import { AwardsCard } from "../components/home/AwardsCard";
import { FeedCard } from "../components/home/FeedCard";
import { ForYouPanel } from "../components/home/ForYouPanel";
import { ReadingStrip } from "../components/home/ReadingStrip";
import { SuggestedReaders } from "../components/home/SuggestedReaders";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { SECTION_HEADING } from "../components/page/surfaceClasses";
import { toolbarIconClass } from "../components/Toolbar";
import { useCircleFeed } from "../hooks/useDashboard";
import { useFeedActions } from "../hooks/useFeedActions";
import { useLibrary } from "../hooks/useLibrary";
import { homeGames } from "../lib/homeGames";
import { useT } from "../i18n";

const SECTION_LINK = "inline-flex min-h-11 shrink-0 items-center font-semibold text-(--color-accent)";
const GROUP_LABEL = "mb-3 font-semibold text-(--color-text-dim)";

export function HomePage() {
  const t = useT();
  const { session } = useAuth();
  const library = useLibrary();
  const circle = useCircleFeed();
  const shelf = useQuery({ queryKey: ["topShelf", "month", null, "games"], queryFn: () => fetchTopShelf({ period: "month", genre: null, view: "games" }), staleTime: 30_000, retry: 1 });
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
  const circleItems = circle.items;
  const actions = useFeedActions(circleItems);
  const { fetchNextPage } = circle;
  const circleLoading = circle.isLoading || (circleItems.length === 0 && circle.hasNextPage === true && !circle.isError);

  useEffect(() => {
    if (circleItems.length === 0 && circle.hasNextPage && !circle.isFetchingNextPage && !circle.isError) void fetchNextPage();
  }, [circleItems.length, circle.hasNextPage, circle.isFetchingNextPage, circle.isError, fetchNextPage]);

  const saved = (
    <Link to="/dashboard/saved" aria-label={t("library.savedTitle")} className={toolbarIconClass()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h12v17l-6-4-6 4Z" /></svg>
    </Link>
  );

  return <Page title={t("shell.areaHome")} actions={saved}>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
      <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
        <DailyChapterCard />
        {awards.data ? <AwardsCard announcements={awards.data.announcements} library={library.data ?? null} /> : null}
        <section aria-labelledby="home-games">
          <div className="mb-3.5 flex items-baseline justify-between gap-3">
            <h2 id="home-games" className={SECTION_HEADING}>{t("shell.areaGames")}</h2>
            <Link to="/community/discover" className={SECTION_LINK}>{t("book.browseAll")}</Link>
          </div>
          {loadingGames ? <p role="status">{t("book.loadingGames")}</p> : gamesFailed ? (
            <div role="alert" className="space-y-3">
              <p>{t("book.gamesLoadFailed")}</p>
              <button type="button" className={BUTTON_SECONDARY} onClick={() => { void circle.refetch(); void shelf.refetch(); void newest.refetch(); }}>{t("library.retry")}</button>
            </div>
          ) : noGames ? <p className="text-(--color-text-dim)">{t("book.noGamesYet")}</p> : (
            <div className="space-y-6">
              {games.followed.length > 0 ? <div>
                <p className={GROUP_LABEL}>{t("book.fromFollowed")}</p>
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
        <ForYouPanel />
        {library.isPending ? <p role="status">{t("book.loadingReading")}</p> : library.isError ? (
          <div role="alert" className="space-y-3"><p>{t("library.libraryLoadFailedOwn")}</p><button type="button" className={BUTTON_SECONDARY} onClick={() => void library.refetch()}>{t("library.retry")}</button></div>
        ) : books.length === 0 ? (
          <EmptyState title={t("library.startLibraryTitle")} body={t("library.startLibraryBody")} action={<div className="flex flex-wrap justify-center gap-2"><Link className={BUTTON_PRIMARY} to="/dashboard/library?action=import">{t("library.importHeading")}</Link><Link className={BUTTON_SECONDARY} to="/dashboard/library?action=add">{t("library.addBook")}</Link></div>} />
        ) : <ReadingStrip books={reading} works={library.data?.works} />}
        <SuggestedReaders />
      </div>
      <section aria-labelledby="home-circle" className="min-w-0 lg:col-start-1 lg:row-start-2">
        <div className="mb-3.5 flex items-baseline justify-between gap-3">
          <h2 id="home-circle" className={SECTION_HEADING}>{t("book.readingCircle")}</h2>
          <Link to="/community/people" className={SECTION_LINK}>{t("book.findPeopleArrow")}</Link>
        </div>
        {actions.loadError ? (
          <div role="alert" className="mb-4 space-y-1">
            <p>{actions.loadError}</p>
            <button type="button" className={BUTTON_SECONDARY} onClick={actions.retryLoad}>{t("library.retry")}</button>
          </div>
        ) : null}
        {circleItems.length > 0 ? <div className="flex flex-col gap-4">{circleItems.map((item) => <FeedCard key={`${item.kind}:${item.id}`} item={item} actions={actions} books={books} works={library.data?.works} />)}</div> : null}
        {circleLoading ? <p role="status">{t("book.loadingCircle")}</p> : null}
        {circle.isError ? (
          <div role="alert" className="mt-4 space-y-3">
            <p>{t("book.circleLoadFailed")}</p>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void circle.refetch()}>{t("library.retry")}</button>
          </div>
        ) : null}
        {!circleLoading && !circle.isError && circleItems.length === 0 && circle.hasNextPage === false ? (
          <EmptyState icon={CommunityIcon} title={t("book.circleEmptyTitle")} body={t("book.circleEmptyBody")} action={<Link className={BUTTON_SECONDARY} to="/community/people">{t("book.findPeople")}</Link>} />
        ) : null}
        {circleItems.length > 0 && circle.hasNextPage ? (
          <div className="mt-4 flex justify-center"><button type="button" className={BUTTON_SECONDARY} disabled={circle.isFetchingNextPage} onClick={() => void circle.fetchNextPage()}>{t("library.loadMore")}</button></div>
        ) : null}
      </section>
    </div>
  </Page>;
}
