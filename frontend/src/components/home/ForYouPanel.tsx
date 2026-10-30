import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { clearDashboardCounts, digestTarget, isNewDigestItem, newCountLabel, type DashboardFeedPage } from "@scripta/shared";
import { activityRowModel, followFailureMessage, isPersonalItem, relativeTime, shouldMarkFeedSeen, type PersonalItem } from "@scripta/shared/community";
import { followUser, markDashboardSeen } from "../../api/community";
import { useActivityFeed } from "../../hooks/useDashboard";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { ArenaIcon, CommunityIcon } from "../NavIcons";
import { BUTTON_SECONDARY } from "../page/buttonClasses";
import { LIST_PANEL, LIST_ROW, LIST_ROW_LINK, PANEL_HEADING } from "../page/surfaceClasses";

const ACTIVITY_KEY = ["community", "dashboard", "activity"];
const NOTE = "px-4.5 py-3 text-(--color-text-dim)";

function Row({ item, isNew, children }: { item: PersonalItem; isNew: boolean; children?: ReactNode }) {
  const row = activityRowModel(item);
  const person = item.kind === "follow" ? item.actor : item.kind === "participation" ? item.actors[0] : undefined;
  const time = relativeTime(item.createdAt);
  return (
    <>
      {person ? <AuthorAvatar author={person} size={32} /> : <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-(--color-accent)">{item.kind === "completion" ? <ArenaIcon size={16} /> : <CommunityIcon size={16} />}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words">
          {row.lead ? <span className="font-bold">{row.lead} </span> : null}
          {row.verb}
          {row.target ? <span className="font-bold"> {row.target}</span> : null}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-(--color-text-dim)">
          {isNew ? <span role="img" aria-label="New" className="size-2 shrink-0 rounded-full bg-(--color-accent)" /> : null}
          {time}
        </span>
      </span>
      {children}
    </>
  );
}

export function ForYouPanel() {
  const queryClient = useQueryClient();
  const feed = useActivityFeed();
  const { fetchNextPage } = feed;
  const items = feed.items.filter(isPersonalItem);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const rowVisible = useRef(false);
  const seenSent = useRef(false);
  const seenInFlight = useRef(false);

  const markSeen = useCallback(() => {
    if (!shouldMarkFeedSeen({ focused: document.visibilityState === "visible", rowVisible: rowVisible.current && items.length > 0, loaded: !feed.isLoading, failed: feed.isError, fetching: feed.isFetching, sent: seenSent.current })) return;
    seenSent.current = true;
    seenInFlight.current = true;
    void markDashboardSeen().then(
      () => {
        seenInFlight.current = false;
        queryClient.setQueryData<InfiniteData<DashboardFeedPage>>(ACTIVITY_KEY, (data) => (data ? clearDashboardCounts(data) : data));
      },
      () => {
        seenInFlight.current = false;
        seenSent.current = false;
      }
    );
  }, [items.length, feed.isLoading, feed.isError, feed.isFetching, queryClient]);

  useEffect(() => {
    if (feed.personalNewCount > 0 && !seenInFlight.current) seenSent.current = false;
    markSeen();
  }, [markSeen, feed.personalNewCount]);

  useEffect(() => {
    document.addEventListener("visibilitychange", markSeen);
    return () => document.removeEventListener("visibilitychange", markSeen);
  }, [markSeen]);

  useEffect(() => {
    if (!list.current) return;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      rowVisible.current = visible.size > 0;
      markSeen();
    }, { threshold: 0.5 });
    for (const row of list.current.children) observer.observe(row);
    return () => observer.disconnect();
  }, [items.length, markSeen]);

  async function followBack(userId: string) {
    setBusyId(userId);
    setError(null);
    try {
      await followUser(userId);
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
      if ((await feed.refetch()).isError) setError("Couldn't refresh activity.");
    } catch (failure) {
      setError(followFailureMessage(failure, "Couldn't follow them. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (items.length === 0 && feed.hasNextPage && !feed.isFetching && !feed.isError) void fetchNextPage();
  }, [items.length, feed.hasNextPage, feed.isFetching, feed.isError, fetchNextPage]);

  const count = newCountLabel(feed.personalNewCount);
  return (
    <section aria-labelledby="home-foryou" className={LIST_PANEL}>
      <div className="flex items-center justify-between gap-3 px-4.5 pt-4 pb-1.5">
        <h2 id="home-foryou" className={PANEL_HEADING}>For you</h2>
        {count ? <span className="rounded-full bg-(--color-accent-soft) px-2.5 py-0.5 text-xs font-semibold text-(--color-accent)">{`${count} new`}</span> : null}
      </div>
      {feed.isLoading ? <p role="status" className={NOTE}>Loading…</p> : feed.isError && items.length === 0 ? (
        <div role="alert" className="space-y-3 px-4.5 py-3">
          <p>Couldn't load activity.</p>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => void feed.refetch()}>Retry</button>
        </div>
      ) : items.length === 0 && feed.hasNextPage && !feed.isError ? <p role="status" className={NOTE}>Loading…</p> : items.length === 0 && !feed.hasNextPage ? <p className={NOTE}>Nothing new yet. New followers and plays of your games show up here.</p> : (
        <ul ref={list} className="divide-y divide-(--color-border)">
          {items.map((item) => {
            const row = activityRowModel(item);
            const isNew = isNewDigestItem(item, feed.seenAt);
            const key = `${item.kind}:${item.id}`;
            if (row.action.kind === "open") {
              return (
                <li key={key}>
                  <Link to={digestTarget(item)} className={LIST_ROW_LINK}>
                    <Row item={item} isNew={isNew}>
                      <span className="shrink-0 font-semibold text-(--color-accent)">{row.action.label} →</span>
                    </Row>
                  </Link>
                </li>
              );
            }
            return (
              <li key={key} className={LIST_ROW}>
                <Link to={digestTarget(item)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                  <Row item={item} isNew={isNew} />
                </Link>
                {row.action.kind === "followBack" && item.kind === "follow" ? (
                  <button type="button" aria-label={`Follow back ${item.actor.username}`} className={`${BUTTON_SECONDARY} shrink-0`} disabled={busyId === item.actor.userId} onClick={() => void followBack(item.actor.userId)}>Follow back</button>
                ) : <span className="shrink-0 text-(--color-text-dim)">Following</span>}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p role="alert" className="px-4.5 py-3 text-sm text-(--color-danger)">{error}</p> : null}
      {feed.hasNextPage ? <div className="px-4.5 py-3"><button type="button" className={BUTTON_SECONDARY} disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>Show more</button></div> : null}
    </section>
  );
}
