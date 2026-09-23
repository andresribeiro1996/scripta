import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_TIER_PRESET } from "@scripta/shared";
import type { ContentTone, DiscoverItem, DiscoverType } from "@scripta/shared/community";
import { contentKindLabel, contentStats, contentStatus, contentTarget } from "@scripta/shared/community";
import { EmptyState } from "../components/EmptyState";
import { CommunityIcon } from "../components/NavIcons";
import { SkeletonCardGrid } from "../components/Skeleton";
import { useCommunityDiscover } from "../hooks/useCommunity";

const DISCOVER_FILTERS: Array<{ value: DiscoverType; label: string }> = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" }
];

const segmented = (active: boolean, first: boolean) =>
  `flex min-h-11 flex-1 items-center justify-center px-3 text-sm font-semibold ${first ? "" : "border-l border-(--color-border)"} ${
    active ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"
  }`;

const STATUS_TONES: Record<ContentTone, string> = {
  neutral: "border-(--color-border) bg-(--color-surface) text-(--color-text-dim)",
  accent: "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)",
  info: "border-(--color-info) bg-(--color-info-soft) text-(--color-info)",
  success: "border-(--color-success) bg-(--color-success-soft) text-(--color-success)",
  reference: "border-(--color-reference) bg-(--color-reference-soft) text-(--color-reference)"
};

const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 58;
const LADDER_WIDTH = 4;
const FAN_INSET = LADDER_WIDTH + 6;
const FAN_WIDTH = 34;
const FAN_HEIGHT = 51;
const FAN_STEP = (THUMB_WIDTH - FAN_INSET - FAN_WIDTH) / 2;
const FAN_TILT = 6;
const PAIR_GAP = 4;
const PAIR_WIDTH = (THUMB_WIDTH - PAIR_GAP) / 2;
const PAIR_HEIGHT = 45;

const searchInput =
  "mb-3 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none focus:border-(--color-accent)";

function retryButton(refetch: () => void) {
  return (
    <button onClick={() => void refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">
      Retry
    </button>
  );
}

export function DiscoverPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-6 text-lg font-bold">Discover</h2>
      <DiscoverPane />
    </div>
  );
}

function DiscoverPane() {
  const [type, setType] = useState<DiscoverType>("all");
  const [search, setSearch] = useState("");
  const { items, isLoading, error, refetch } = useCommunityDiscover(type, search.trim());

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tier lists and tournaments" aria-label="Search tier lists and tournaments by name" className={searchInput} />
      <div className="mb-4 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) sm:w-72">
        {DISCOVER_FILTERS.map((f, i) => (
          <button key={f.value} onClick={() => setType(f.value)} aria-pressed={type === f.value} className={segmented(type === f.value, i === 0)}>
            {f.label}
          </button>
        ))}
      </div>
      {isLoading && <SkeletonCardGrid count={4} label="Loading published games" tileClassName="min-h-[110px]" />}
      {!isLoading && error && <EmptyState title="Couldn't load tier lists and tournaments." action={retryButton(refetch)} />}
      {!isLoading && !error && items.length === 0 && (
        <EmptyState icon={CommunityIcon} title="Nothing published yet." body="Published tier lists and tournaments show up here." />
      )}
      {!isLoading && !error && items.length > 0 && (
        <ul className="border-t border-(--color-border)">
          {items.map((item) => (
            <DiscoverRow key={`${item.content.kind}:${item.content.id}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DiscoverRow({ item }: { item: DiscoverItem }) {
  const { content, author } = item;
  const status = contentStatus(content);
  return (
    <li className="relative flex items-center gap-3 border-b border-(--color-border) px-2 py-3 hover:bg-(--color-surface-hover)">
      {content.kind === "tierlist" ? <TierlistThumb covers={content.covers} /> : <TournamentThumb covers={content.covers} />}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">
          <Link to={contentTarget(content)} className="after:absolute after:inset-0">
            {content.name}
          </Link>
        </h3>
        <p className="truncate text-xs text-(--color-text-dim)">
          {contentKindLabel(content)} ·{" "}
          {author.unavailable ? (
            author.username
          ) : (
            <Link to={`/community/u/${author.username}`} className="relative z-10 hover:text-(--color-accent)">
              {author.username}
            </Link>
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-(--color-text-dim)">
          <span className={`rounded-full border px-2 font-semibold ${STATUS_TONES[status.tone]}`}>{status.label}</span>
          {contentStats(content).map((stat) => (
            <span key={stat.label}>
              <span className="font-semibold text-(--color-text)">{stat.value}</span> {stat.label}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}

function TierlistThumb({ covers }: { covers: string[] }) {
  const fan: Array<string | null> = covers.length ? covers.slice(0, 3) : [null];
  const middle = (fan.length - 1) / 2;
  return (
    <div aria-hidden="true" className="relative shrink-0" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
      <div className="absolute left-0 flex flex-col overflow-hidden rounded-sm" style={{ top: (THUMB_HEIGHT - FAN_HEIGHT) / 2, width: LADDER_WIDTH, height: FAN_HEIGHT }}>
        {DEFAULT_TIER_PRESET.map((tier) => (
          <span key={tier.label} className="flex-1" style={{ backgroundColor: tier.color }} />
        ))}
      </div>
      {fan.map((cover, index) => (
        <Cover
          key={cover ?? index}
          src={cover}
          style={{
            left: FAN_INSET + index * FAN_STEP + (3 - fan.length) * (FAN_STEP / 2),
            top: (THUMB_HEIGHT - FAN_HEIGHT) / 2,
            width: FAN_WIDTH,
            height: FAN_HEIGHT,
            zIndex: index,
            transform: `rotate(${(index - middle) * FAN_TILT}deg)`
          }}
        />
      ))}
    </div>
  );
}

function TournamentThumb({ covers }: { covers: string[] }) {
  return (
    <div aria-hidden="true" className="relative shrink-0" style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
      {[covers[0] ?? null, covers[1] ?? null].map((cover, index) => (
        <Cover key={index} src={cover} style={{ left: index * (PAIR_WIDTH + PAIR_GAP), top: (THUMB_HEIGHT - PAIR_HEIGHT) / 2, width: PAIR_WIDTH, height: PAIR_HEIGHT }} />
      ))}
      <span className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-(--color-border) bg-(--color-surface) px-1.5 text-[10px] leading-4 font-bold tracking-widest">
        VS
      </span>
    </div>
  );
}

function Cover({ src, style }: { src: string | null; style: CSSProperties }) {
  const className = "absolute rounded-[3px] border border-(--color-bg) object-cover";
  return src ? <img src={src} alt="" loading="lazy" className={className} style={style} /> : <span className={`${className} bg-(--color-border)`} style={style} />;
}
