import { useEffect, useState } from "react";
import {
  coverQueryKey,
  coverSourceLabel,
  isCurrentCover,
  visibleCandidates,
  type CoverCandidatesResponse,
  type CoverCandidateView,
  type CoverPickSource,
  type ResolvedCoverResponse
} from "@scripta/shared";
import { fetchCoverCandidates, pickCover, type ResolveCoverParams } from "../api/covers";

type Load = { state: "pending" } | { state: "done"; response: CoverCandidatesResponse } | { state: "failed"; message: string };
type Size = { width: number; height: number } | null;

const PENDING: Load = { state: "pending" };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function FoundCovers({
  lookup,
  coverUrl,
  isAdmin = false,
  onPick
}: {
  lookup: ResolveCoverParams;
  coverUrl?: string | null;
  isAdmin?: boolean;
  onPick: (cover: ResolvedCoverResponse, everyone: boolean) => void;
}) {
  const [quick, setQuick] = useState<Load>(PENDING);
  const [apple, setApple] = useState<Load>(PENDING);
  const [measured, setMeasured] = useState<ReadonlyMap<string, Size>>(new Map());
  const [picking, setPicking] = useState(false);
  const [pickFailure, setPickFailure] = useState<{ url: string; message: string } | null>(null);
  const lookupKey = coverQueryKey(lookup);

  useEffect(() => {
    let current = true;
    function load(from: CoverPickSource, set: (next: Load) => void) {
      fetchCoverCandidates(lookup, from).then(
        (response) => current && set({ state: "done", response }),
        (error: unknown) => current && set({ state: "failed", message: messageOf(error) })
      );
    }
    load("quick", setQuick);
    load("apple", setApple);
    return () => {
      current = false;
    };
  }, [lookupKey]);

  function measure(url: string, size: Size) {
    setMeasured((previous) => new Map(previous).set(url, size));
  }

  async function choose(candidate: CoverCandidateView, everyone: boolean) {
    setPicking(true);
    setPickFailure(null);
    try {
      const cover = await pickCover(lookup, candidate.coverImageId ? { coverImageId: candidate.coverImageId } : { url: candidate.url }, everyone);
      onPick(cover, everyone);
    } catch (error) {
      setPickFailure({ url: candidate.url, message: messageOf(error) });
    } finally {
      setPicking(false);
    }
  }

  const loads = [quick, apple];
  const tiles = visibleCandidates(
    loads.flatMap((load) => (load.state === "done" ? load.response.candidates : [])),
    measured
  );
  const unavailable = [...new Set(loads.flatMap((load) => (load.state === "done" ? load.response.unavailable : [])))];
  const failures = [...new Set(loads.flatMap((load) => (load.state === "failed" ? [load.message] : [])))];
  const checkingApple = apple.state === "pending";

  if (tiles.length === 0 && unavailable.length === 0 && failures.length === 0 && !checkingApple) return null;

  return (
    <section className="mb-4">
      <h3 className="mb-2 text-sm font-semibold">Found covers</h3>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {tiles.map(({ candidate, width, height }) => (
          <div key={candidate.url} className="flex flex-col">
            <button
              type="button"
              disabled={picking}
              aria-label={`Use this ${coverSourceLabel(candidate.source)} cover`}
              aria-current={isCurrentCover(candidate, coverUrl)}
              onClick={() => void choose(candidate, false)}
              className={`relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 bg-(--color-border) disabled:cursor-default disabled:opacity-50 ${
                isCurrentCover(candidate, coverUrl) ? "border-(--color-accent)" : "border-transparent"
              }`}
            >
              <img
                src={candidate.url}
                alt=""
                className="h-full w-full object-contain"
                onLoad={(e) => measure(candidate.url, { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                onError={() => measure(candidate.url, null)}
              />
            </button>
            <p className="mt-1 text-xs text-(--color-text-dim)">
              {width !== null && height !== null && (
                <span className="block">
                  {width} × {height}
                </span>
              )}
              <span className="block">{coverSourceLabel(candidate.source)}</span>
            </p>
            {isAdmin && (
              <button
                type="button"
                disabled={picking}
                onClick={() => void choose(candidate, true)}
                className="min-h-11 text-left text-xs font-semibold text-(--color-accent) transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                Use for everyone
              </button>
            )}
            {pickFailure?.url === candidate.url && (
              <p role="alert" className="text-xs text-(--color-danger)">
                {pickFailure.message}
              </p>
            )}
          </div>
        ))}
        {checkingApple && (
          <div className="flex aspect-square items-center justify-center rounded-lg border-2 border-transparent bg-(--color-border) p-2 text-center text-xs text-(--color-text-dim)">
            Checking Apple Books…
          </div>
        )}
      </div>
      {unavailable.map((name) => (
        <p key={name} className="mt-2 text-xs text-(--color-text-dim)">
          {coverSourceLabel(name)} didn't answer.
        </p>
      ))}
      {failures.map((message) => (
        <p key={message} className="mt-2 text-xs text-(--color-danger)">
          {message}
        </p>
      ))}
    </section>
  );
}
