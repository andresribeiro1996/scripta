import { useEffect, useState } from "react";
import { BOOKS, coverSrc, type BookSlug } from "./books";

type Flash = "a" | "b" | null;

type Side =
  | { kind: "empty" }
  | { kind: "static"; slug: BookSlug; dimmed: boolean; winner: boolean }
  | { kind: "button"; slug: BookSlug; dimmed: boolean; winner: boolean; onPick: () => void };

type Tile = { a: Side; b: Side; active: boolean; dot: boolean; vsOp: number };
type Row = { label: string; tiles: Tile[]; champTitle?: string };

type Geo = {
  width: number;
  height: number;
  coverW: number;
  coverH: number;
  rowH: number;
  rowTops: number[];
  centerLeft: number;
  centerRight: number;
  centerMid: number;
  vsW: number;
  labelTop: number;
  labelFontSize: number;
  vsFontSize: number;
  dotSize: number;
  checkSize: number;
  checkFontSize: number;
  path: string;
  champion?: { left: number; top: number };
};

const DESKTOP_GEO: Geo = {
  width: 512,
  height: 628,
  coverW: 56,
  coverH: 84,
  rowH: 84,
  rowTops: [0, 136, 272, 408, 544],
  centerLeft: 128,
  centerRight: 384,
  centerMid: 256,
  vsW: 20,
  labelTop: 35,
  labelFontSize: 10,
  vsFontSize: 10,
  dotSize: 12,
  checkSize: 16,
  checkFontSize: 10,
  path: "M128 84V110H384V84M256 110V136M256 220V272M256 356V408M256 492V518M128 544V518H384V544",
  champion: { left: 340, top: 32 },
};

const PHONE_GEO: Geo = {
  width: 326,
  height: 412,
  coverW: 40,
  coverH: 60,
  rowH: 60,
  rowTops: [0, 88, 176, 264, 352],
  centerLeft: 110,
  centerRight: 262,
  centerMid: 186,
  vsW: 16,
  labelTop: 23,
  labelFontSize: 9,
  vsFontSize: 9,
  dotSize: 10,
  checkSize: 14,
  checkFontSize: 9,
  path: "M110 60V74H262V60M186 74V88M186 148V176M186 236V264M186 324V338M110 352V338H262V352",
};

function side(slug: BookSlug | null, winner: BookSlug | null, active: boolean, onPick: () => void): Side {
  if (!slug) return { kind: "empty" };
  const dimmed = !!winner && winner !== slug;
  const winnerSide = winner === slug;
  return active ? { kind: "button", slug, dimmed, winner: winnerSide, onPick } : { kind: "static", slug, dimmed, winner: winnerSide };
}

function buildRows(round: number, winners: (BookSlug | null)[], flash: Flash, pickW: BookSlug | null, onVote: (side: "a" | "b") => void): Row[] {
  const fixed = (a: BookSlug, b: BookSlug, w: BookSlug): Tile => ({
    a: side(a, w, false, () => {}),
    b: side(b, w, false, () => {}),
    active: false,
    dot: false,
    vsOp: 1,
  });
  const match = (i: number, a: BookSlug | null, b: BookSlug | null): Tile => {
    const active = round === i;
    const winner = winners[i] ?? (active ? pickW : null);
    return {
      a: side(a, winner, active, () => onVote("a")),
      b: side(b, winner, active, () => onVote("b")),
      active,
      dot: active && !flash,
      vsOp: a && b ? 1 : 0.5,
    };
  };
  return [
    { label: "Round 1", tiles: [fixed("piranesi", "normal-people", "piranesi"), fixed("hail-mary", "sapiens", "hail-mary")] },
    { label: "Semis", tiles: [match(0, "piranesi", "hail-mary")] },
    { label: "Final", tiles: [match(2, winners[0], winners[1])], champTitle: winners[2] ? BOOKS[winners[2]].title : undefined },
    { label: "Semis", tiles: [match(1, "circe", "gilead")] },
    { label: "Round 1", tiles: [fixed("circe", "achilles", "circe"), fixed("gilead", "klara", "gilead")] },
  ];
}

function TrophyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
    </svg>
  );
}

function SideView({ view, geo }: { view: Side; geo: Geo }) {
  const size = { width: geo.coverW, height: geo.coverH };
  if (view.kind === "empty") {
    return <span aria-hidden="true" className="block rounded-[3px] bg-(--color-border) opacity-60" style={size} />;
  }
  const title = BOOKS[view.slug].title;
  const imgStyle = { ...size, opacity: view.dimmed ? 0.45 : 1, border: view.winner ? "2px solid var(--color-accent)" : "0" };
  const check = view.winner && (
    <span
      aria-hidden="true"
      className="absolute flex items-center justify-center rounded-full bg-(--color-accent) font-bold text-(--color-on-accent)"
      style={{ top: -4, right: -4, width: geo.checkSize, height: geo.checkSize, fontSize: geo.checkFontSize }}
    >
      ✓
    </span>
  );
  if (view.kind === "button") {
    return (
      <span className="relative block" style={size}>
        <button
          type="button"
          onClick={view.onPick}
          aria-label={`Vote for ${title}`}
          className="block rounded-[3px] border-0 bg-transparent p-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-safe:hover:-translate-y-1"
          style={size}
        >
          <img src={coverSrc(view.slug)} alt="" className="block rounded-[3px] object-cover transition-opacity duration-200" style={imgStyle} />
        </button>
        {check}
      </span>
    );
  }
  return (
    <span className="relative block" style={size}>
      <img src={coverSrc(view.slug)} alt={title} className="block rounded-[3px] object-cover transition-opacity duration-200" style={imgStyle} />
      {check}
    </span>
  );
}

function BracketView({ geo, rows, className }: { geo: Geo; rows: Row[]; className: string }) {
  const halfWidth = (geo.coverW * 2 + geo.vsW) / 2;
  return (
    <div className={`relative ${className}`} style={{ height: geo.height }}>
      <svg
        width={geo.width}
        height={geo.height}
        viewBox={`0 0 ${geo.width} ${geo.height}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        aria-hidden="true"
        className="absolute left-0 top-0 text-(--color-border)"
      >
        <path d={geo.path} />
      </svg>
      {rows.map((row, i) => (
        <div key={i} className="absolute left-0 right-0" style={{ top: geo.rowTops[i], height: geo.rowH }}>
          <span
            className="absolute left-0 font-bold uppercase leading-[14px] tracking-[0.3px]"
            style={{ top: geo.labelTop, fontSize: geo.labelFontSize, color: row.label === "Final" ? "var(--color-accent)" : "var(--color-text-dim)" }}
          >
            {row.label}
          </span>
          {row.tiles.map((tile, ti) => {
            const center = row.tiles.length === 2 ? (ti === 0 ? geo.centerLeft : geo.centerRight) : geo.centerMid;
            return (
              <div
                key={ti}
                className="absolute top-0 flex rounded"
                style={{
                  left: center - halfWidth,
                  background: tile.active ? "var(--color-accent-soft)" : "transparent",
                  boxShadow: tile.active ? "0 0 0 6px var(--color-accent-soft)" : "none",
                }}
              >
                {tile.dot && (
                  <span
                    aria-hidden="true"
                    className="absolute z-10 rounded-full border-2 border-(--color-surface) bg-(--color-accent)"
                    style={{ top: -4, right: -4, width: geo.dotSize, height: geo.dotSize }}
                  />
                )}
                <SideView view={tile.a} geo={geo} />
                <span
                  className="flex items-center justify-center font-bold uppercase tracking-[0.3px]"
                  style={{ width: geo.vsW, fontSize: geo.vsFontSize, opacity: tile.vsOp, color: tile.active ? "var(--color-accent)" : "var(--color-text-dim)" }}
                >
                  vs
                </span>
                <SideView view={tile.b} geo={geo} />
              </div>
            );
          })}
          {geo.champion && row.champTitle && (
            <div
              className="absolute flex items-center gap-1.5 whitespace-nowrap text-sm font-bold text-(--color-accent)"
              style={{ left: geo.champion.left, top: geo.champion.top }}
            >
              <TrophyIcon />
              {row.champTitle}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function TournamentBracket() {
  const [round, setRound] = useState(0);
  const [winners, setWinners] = useState<(BookSlug | null)[]>([null, null, null]);
  const [flash, setFlash] = useState<Flash>(null);

  function duelPair(r: number): [BookSlug, BookSlug] {
    if (r === 0) return ["piranesi", "hail-mary"];
    if (r === 1) return ["circe", "gilead"];
    return [winners[0]!, winners[1]!];
  }

  function vote(side: "a" | "b") {
    if (flash || round > 2) return;
    setFlash(side);
  }

  function again() {
    setRound(0);
    setWinners([null, null, null]);
    setFlash(null);
  }

  const tDone = round > 2;
  const pickW = flash && round < 3 ? duelPair(round)[flash === "a" ? 0 : 1] : null;

  useEffect(() => {
    if (!pickW) return;
    const id = setTimeout(() => {
      setWinners((prev) => prev.map((w, i) => (i === round ? pickW : w)));
      setRound(round + 1);
      setFlash(null);
    }, 650);
    return () => clearTimeout(id);
  }, [pickW, round]);
  const rows = buildRows(round, winners, flash, pickW, vote);
  const badge =
    round < 3
      ? { label: round < 2 ? "Round 2 of 3" : "Round 3 of 3", cls: "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" }
      : { label: "Completed", cls: "border-(--color-success) bg-(--color-success-soft) text-(--color-success)" };

  function hint(isPhone: boolean) {
    if (tDone) {
      const title = BOOKS[winners[2]!].title;
      return isPhone ? `${title} wins.` : `${title} is your book of the year.`;
    }
    if (flash) return "Vote counted.";
    return `${["Semifinal 1", "Semifinal 2", "The final"][round]} · tap a cover to vote · 18h left`;
  }

  return (
    <div className="flex flex-col rounded-2xl border border-(--color-border) bg-(--color-bg) p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-semibold">Tournament</span>
          <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
        </div>
        <span className="hidden text-[13px] text-(--color-text-dim) lg:inline">Book of the year · 8 books</span>
      </div>
      <BracketView geo={DESKTOP_GEO} rows={rows} className="mt-7 hidden lg:block" />
      <BracketView geo={PHONE_GEO} rows={rows} className="mt-5 lg:hidden" />
      <div className="mt-3 flex min-h-11 items-center justify-center gap-4 text-center text-[13px] leading-relaxed text-(--color-text-dim) lg:mt-6">
        <span className="hidden lg:inline">{hint(false)}</span>
        <span className="lg:hidden">{hint(true)}</span>
        {tDone && (
          <button
            type="button"
            onClick={again}
            className="flex min-h-11 items-center rounded-lg border border-(--color-border) bg-(--color-surface) px-4 text-sm font-semibold text-(--color-text) transition-colors hover:bg-(--color-surface-hover)"
          >
            Run it again
          </button>
        )}
      </div>
    </div>
  );
}
