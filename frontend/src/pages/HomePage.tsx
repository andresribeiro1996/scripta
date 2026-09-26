import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { bookKey, buildDashboardCards, digestHeading, digestTarget, resolveQuote } from "@scripta/shared";
import { useDashboard } from "../hooks/useDashboard";
import { useLibrary } from "../hooks/useLibrary";
import { useAuth } from "../auth/AuthContext";
import { PageContainer } from "../components/PageContainer";
import { BookGrid } from "../components/BookGrid";
import { BookCard } from "../components/BookCard";
import { AuthorAvatar } from "../components/CommunityAuthorAvatar";
import { resolveLibraryStyle } from "../lib/libraryStyle";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-(--color-border) px-4 py-2 text-sm hover:bg-(--color-surface-hover) disabled:opacity-50";

export function HomePage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const dashboard = useDashboard();
  const library = useLibrary();
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const books = library.data?.data.books ?? [];
  const style = resolveLibraryStyle(library.data?.data.style);
  const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
  const cards = session ? buildDashboardCards(books, day, session.user.id) : [];

  return <PageContainer>
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Home</h1>
        <div className="flex flex-wrap gap-2">
          <Link className={button} to="/community/people">Find people</Link>
          <Link className={button} to="/community/discover">Discover</Link>
        </div>
      </header>
      {dashboard.isLoading || library.isPending ? <p role="status">Loading home…</p> : dashboard.error || library.isError ? <div role="alert"><p>Couldn't load your home.</p><button className={button} onClick={() => { void dashboard.refetch(); void library.refetch(); }}>Retry</button></div> : <>
        {!books.length ? <div className="space-y-3 rounded-xl border border-(--color-border) p-6"><h2 className="text-xl">Start your library</h2><p>Import your existing collection, or add your first book manually.</p><div className="flex flex-wrap gap-2"><Link className={`${button} bg-(--color-accent) text-white`} to="/dashboard/library?action=import">Import library</Link><Link className={button} to="/dashboard/library?action=add">Add a book manually</Link></div></div>
          : cards.map((card) => {
            if (card.kind === "currentlyReading" || card.kind === "upNext") {
              const section = card.kind === "currentlyReading" ? card.bookKeys : card.bookKeys.slice(0, 6);
              const sectionBooks = section.flatMap((key) => { const book = byKey.get(key); return book ? [book] : []; });
              if (!sectionBooks.length) return null;
              return <section key={card.kind} aria-label={card.kind === "currentlyReading" ? "Currently reading" : "Up next"} className="space-y-3">
                <h2 className="text-xl">{card.kind === "currentlyReading" ? "Currently reading" : "Up next"}</h2>
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
        <section aria-label="Following" className="space-y-3">
          <h2 className="text-xl">Following</h2>
          {dashboard.newCount > 0 ? <p className="text-sm font-semibold text-(--color-accent)">You have {dashboard.newCount} new</p> : null}
          {dashboard.items.length === 0 ? <p className="text-sm text-(--color-text-dim)">Nothing here yet. Follow people to see what they publish.</p> : (
            <div className="space-y-3">
              {dashboard.items.map((item) => (
                <div key={`${item.kind}:${item.id}`} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
                  <Link to={digestTarget(item)} className="flex items-center gap-2">
                    <AuthorAvatar author={item.actor} />
                    <span>
                      <span className="block text-sm font-semibold">{digestHeading(item)}</span>
                      {item.kind === "publication" ? <span className="block text-sm text-(--color-text-dim)">{item.content.name}</span> : null}
                    </span>
                  </Link>
                </div>
              ))}
            </div>
          )}
          {dashboard.hasNextPage && (
            <button
              onClick={() => void dashboard.fetchNextPage()}
              disabled={dashboard.isFetchingNextPage}
              className="w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm text-(--color-text-dim) hover:border-(--color-accent) disabled:opacity-50"
            >
              {dashboard.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </section>
      </>}
    </div>
  </PageContainer>;
}
