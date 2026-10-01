import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { bookKey, buildDashboardCards, clearDashboardCounts, digestAction, digestHeading, digestTarget, isNewDigestItem, newCountLabel, resolveQuote, type DashboardFeedPage } from "@scripta/shared";
import { markDashboardSeen } from "../api/community";
import { DASHBOARD_QUERY_KEY, useDashboard } from "../hooks/useDashboard";
import { useLibrary } from "../hooks/useLibrary";
import { useAuth } from "../auth/AuthContext";
import { PageContainer } from "../components/PageContainer";
import { BookGrid } from "../components/BookGrid";
import { BookCard } from "../components/BookCard";
import { AuthorAvatar } from "../components/CommunityAuthorAvatar";
import { PickNextSheet } from "../components/PickNextSheet";
import { ReaderGlyph } from "../components/ReaderGlyph";
import { resolveLibraryStyle } from "../lib/libraryStyle";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-(--color-border) px-4 py-2 text-sm hover:bg-(--color-surface-hover) disabled:opacity-50";

export function HomePage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const dashboard = useDashboard();
  const library = useLibrary();
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const [picking, setPicking] = useState(false);
  const [activity, setActivity] = useState<HTMLElement | null>(null);
  const markedRef = useRef(false);
  const { fetchNextPage } = dashboard;
  const skippingEmptyPage = dashboard.items.length === 0 && dashboard.hasNextPage && !dashboard.isFetchNextPageError;
  const loadingActivity = dashboard.isLoading || skippingEmptyPage;
  const settled = !loadingActivity && !dashboard.error && !dashboard.isFetching;
  const newLabel = newCountLabel(dashboard.personalNewCount);

  useEffect(() => {
    if (skippingEmptyPage && !dashboard.isFetching) void fetchNextPage();
  }, [skippingEmptyPage, dashboard.isFetching, fetchNextPage]);

  useEffect(() => {
    if (!activity || !settled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (markedRef.current || !entries.some((entry) => entry.isIntersecting)) return;
        markedRef.current = true;
        void markDashboardSeen().then(
          () => queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(DASHBOARD_QUERY_KEY, (data) => data && clearDashboardCounts(data)),
          () => { markedRef.current = false; }
        );
      },
      { rootMargin: "0px 0px -25% 0px" }
    );
    observer.observe(activity);
    return () => observer.disconnect();
  }, [activity, settled, queryClient]);

  const books = library.data?.data.books ?? [];
  const style = resolveLibraryStyle(library.data?.data.style);
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  const cards = session ? buildDashboardCards(books, day, session.user.id) : [];
  const upNextKeys = cards.find((c) => c.kind === "upNext")?.bookKeys ?? [];

  return <PageContainer>
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Home</h1>
        <div className="flex flex-wrap gap-2">
          <Link className={button} to="/community/people">Find people</Link>
          <Link className={button} to="/community/discover">Discover</Link>
        </div>
      </header>
      {library.isPending ? <p role="status">Loading home…</p> : library.isError ? <div role="alert"><p>Couldn't load your home.</p><button className={button} onClick={() => { void dashboard.refetch(); void library.refetch(); }}>Retry</button></div> : <>
        {!books.length ? <div className="space-y-3 rounded-xl border border-(--color-border) p-6"><h2 className="text-xl">Start your library</h2><p>Import your existing collection, or add your first book manually.</p><div className="flex flex-wrap gap-2"><Link className={`${button} bg-(--color-accent) text-(--color-on-accent)`} to="/dashboard/library?action=import">Import library</Link><Link className={button} to="/dashboard/library?action=add">Add a book manually</Link></div></div>
          : cards.map((card) => {
            if (card.kind === "currentlyReading" || card.kind === "upNext") {
              const section = card.kind === "currentlyReading" ? card.bookKeys : card.bookKeys.slice(0, 6);
              const sectionBooks = section.flatMap((key) => { const book = byKey.get(key); return book ? [book] : []; });
              if (!sectionBooks.length) return null;
              return <section key={card.kind} aria-label={card.kind === "currentlyReading" ? "Currently reading" : "Up next"} className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-xl">{card.kind === "currentlyReading" ? "Currently reading" : "Up next"}</h2>
                  {card.kind === "upNext" && card.bookKeys.length >= 2 ? (
                    <button type="button" className="inline-flex min-h-11 items-center text-sm text-(--color-text-dim) hover:text-(--color-accent)" onClick={() => setPicking(true)}>Can't choose?</button>
                  ) : null}
                </div>
                <BookGrid style={style}>
                  {sectionBooks.map((book) => <BookCard key={bookKey(book)} book={book} onClick={() => navigate(`/dashboard/library?book=${encodeURIComponent(bookKey(book))}`)} style={style} />)}
                </BookGrid>
              </section>;
            }
            const quote = resolveQuote({ type: "quote", bookKey: card.bookKey, highlightId: card.highlightId } as never, books);
            if (!quote) return null;
            return <section key="rediscover" aria-label="Rediscover" className="space-y-3">
              <h2 className="text-xl">Rediscover</h2>
              <blockquote className="space-y-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
                <p>{String(quote.highlight.Text ?? "")}</p>
                <footer className="text-sm text-(--color-text-dim)">{String(quote.book.Title ?? "")}{quote.book.Attribution ? ` — ${String(quote.book.Attribution)}` : ""}</footer>
              </blockquote>
            </section>;
          })}
        <section ref={setActivity} aria-label="Activity" className="space-y-3">
          <h2 className="text-xl">Activity</h2>
          {newLabel ? <p className="text-sm font-semibold text-(--color-accent)">{newLabel} new for you</p> : null}
          {loadingActivity ? <p role="status">Loading activity…</p> : dashboard.error && dashboard.items.length === 0 ? (
            <div role="alert"><p>Couldn't load activity.</p><button className={button} onClick={() => void dashboard.refetch()}>Retry</button></div>
          ) : dashboard.items.length === 0 ? <p className="text-sm text-(--color-text-dim)">Nothing here yet. Follow people to see what they publish.</p> : (
            <>
              {dashboard.isRefetchError && !dashboard.isRefetching ? <p role="alert" className="text-sm text-(--color-danger)">Couldn't refresh activity.</p> : null}
              <div className="space-y-3">
                {dashboard.items.map((item) => (
                  <div key={`${item.kind}:${item.id}`} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
                    <Link to={digestTarget(item)} className="flex items-center gap-2">
                      {item.kind === "participation" ? (
                        <>
                          {item.actors.length > 0 && (
                            <span className="flex shrink-0 -space-x-1">
                              {item.actors.map((actor) => (
                                <span key={actor.userId} className="rounded-full ring-2 ring-(--color-surface)">
                                  <AuthorAvatar author={actor} />
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="text-sm font-semibold">{digestHeading(item)}</span>
                        </>
                      ) : (
                        <>
                          <AuthorAvatar author={item.actor} />
                          <span>
                            <span className="block text-sm font-semibold">
                              <span className="inline-flex items-center gap-1">
                                {item.actor.username}
                                <ReaderGlyph identity={item.actor.readerGlyph} />
                              </span>{" "}
                              {digestAction(item)}
                            </span>
                            {item.kind === "publication" ? <span className="block text-sm text-(--color-text-dim)">{item.content.name}</span> : null}
                          </span>
                        </>
                      )}
                      {isNewDigestItem(item, dashboard.seenAt) ? <span className="ml-auto rounded-full bg-(--color-accent-soft) px-2 text-xs font-semibold text-(--color-accent)">New</span> : null}
                    </Link>
                  </div>
                ))}
              </div>
              {dashboard.isFetchNextPageError && !dashboard.isFetchingNextPage ? <p role="alert" className="text-sm text-(--color-danger)">Couldn't load more.</p> : null}
              {dashboard.hasNextPage && (
                <button
                  onClick={() => void dashboard.fetchNextPage()}
                  disabled={dashboard.isFetchingNextPage}
                  className="w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm text-(--color-text-dim) hover:border-(--color-accent) disabled:opacity-50"
                >
                  {dashboard.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </section>
      </>}
      {picking && upNextKeys.length >= 2 ? <PickNextSheet keys={upNextKeys} books={books} onClose={() => setPicking(false)} /> : null}
    </div>
  </PageContainer>;
}
