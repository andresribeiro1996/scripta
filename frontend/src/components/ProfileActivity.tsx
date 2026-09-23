import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { activityDay, activityRow, relativeTime, type ActivityItem } from "@scripta/shared/community";
import type { useCommunityActivity } from "../hooks/useCommunity";
import { EmptyState } from "./EmptyState";
import { ArenaIcon, CommunityIcon, LibraryIcon, MuralsIcon } from "./NavIcons";
import { SkeletonCardGrid } from "./Skeleton";

const TONE = {
  accent: { text: "text-(--color-accent)", fill: "bg-(--color-accent-soft)" },
  success: { text: "text-(--color-success)", fill: "bg-(--color-success-soft)" },
  dim: { text: "text-(--color-text-dim)", fill: "bg-(--color-surface)" }
} as const;

function Glyph({ item, size }: { item: ActivityItem; size: number }) {
  switch (item.type) {
    case "tournament_published":
      return <ArenaIcon size={size} />;
    case "following":
      return <CommunityIcon size={size} />;
    case "mural_published":
      return <MuralsIcon size={size} />;
    case "book_added":
    case "book_finished":
      return <LibraryIcon size={size} />;
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {item.type === "voted_on" ? <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></> : <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><path d="M4 6.5h1M4 12h1M4 17.5h1" /></>}
        </svg>
      );
  }
}

function ActivityEntry({ item }: { item: ActivityItem }) {
  const row = activityRow(item);
  const tone = TONE[row.tone];
  const target = row.href ?? (row.username ? `/community/u/${row.username}` : null);
  const body: ReactNode = (
    <>
      <span className="relative h-[72px] w-[86px] shrink-0">
        {row.covers.length ? (
          row.covers.map((cover, i) => (
            <img
              key={`${i}:${cover}`}
              src={cover}
              alt=""
              loading="lazy"
              className="absolute h-16 w-[42px] rounded-md object-cover shadow-sm ring-1 ring-black/5"
              style={{ left: 14 + i * 15, top: (row.covers.length - 1 - i) * 4, zIndex: i }}
            />
          ))
        ) : (
          <span className={`absolute top-3 left-3.5 flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-(--color-border) ${tone.fill} ${tone.text}`}>
            <Glyph item={item} size={22} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`flex shrink-0 ${tone.text}`}>
            <Glyph item={item} size={13} />
          </span>
          <span className={`truncate text-xs font-bold ${tone.text}`}>{row.label}</span>
          <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()} className="ml-auto shrink-0 text-xs text-(--color-text-dim) tabular-nums">
            {relativeTime(item.createdAt)}
          </time>
        </span>
        {row.title && <span className="mt-0.5 line-clamp-2 block text-sm font-semibold">{row.title}</span>}
        {row.meta && <span className="block truncate text-xs text-(--color-text-dim)">{row.meta}</span>}
      </span>
    </>
  );
  const className = "flex items-center gap-3 border-b border-(--color-border) px-1 py-3";
  return target ? (
    <Link to={target} className={`${className} -mx-2 rounded-lg px-3 transition-colors hover:bg-(--color-surface-hover)`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function ProfileActivity({ activity }: { activity: ReturnType<typeof useCommunityActivity> }) {
  if (activity.isLoading) return <SkeletonCardGrid count={3} label="Loading activity" tileClassName="min-h-[72px]" />;
  if (activity.error) {
    return (
      <EmptyState
        title="Couldn't load activity."
        action={
          <button onClick={() => void activity.refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">
            Retry
          </button>
        }
      />
    );
  }
  if (activity.items.length === 0) return <EmptyState title="No activity yet." body="Publishing and reading will show up here." />;
  return (
    <div>
      {activity.items.map((item, i) => {
        const day = activityDay(item.createdAt);
        const showDay = i === 0 || activityDay(activity.items[i - 1]!.createdAt) !== day;
        return (
          <div key={item.id}>
            {showDay && <h3 className={`pb-1 text-[11px] font-semibold tracking-wider text-(--color-text-dim) uppercase ${i === 0 ? "" : "pt-5"}`}>{day}</h3>}
            <ActivityEntry item={item} />
          </div>
        );
      })}
      {activity.hasNextPage && (
        <button
          onClick={() => void activity.fetchNextPage()}
          disabled={activity.isFetchingNextPage}
          className="mt-4 w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm text-(--color-text-dim) hover:border-(--color-accent) disabled:opacity-50"
        >
          {activity.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
