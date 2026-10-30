import { useEffect, useRef, useState } from "react";
import {
  coverSourceLabel,
  errorMessage,
  FOUND_COVERS_PENDING,
  foundCoversView,
  isCurrentCover,
  type CoverCandidateView,
  type CoverPickSource,
  type FoundCoversLoad,
  type MeasuredCoverSize,
  type ResolvedCoverResponse
} from "@scripta/shared";
import { fetchCoverCandidates, pickCover, rememberResolvedCover, type ResolveCoverParams } from "../api/covers";

export function FoundCovers({
  lookup: lookupProp,
  coverUrl,
  isAdmin = false,
  onPick
}: {
  lookup: ResolveCoverParams;
  coverUrl?: string | null;
  isAdmin?: boolean;
  onPick: (cover: ResolvedCoverResponse, everyone: boolean) => void;
}) {
  const [quick, setQuick] = useState<FoundCoversLoad>(FOUND_COVERS_PENDING);
  const [apple, setApple] = useState<FoundCoversLoad>(FOUND_COVERS_PENDING);
  const [measured, setMeasured] = useState<ReadonlyMap<string, MeasuredCoverSize>>(new Map());
  const [picking, setPicking] = useState(false);
  const [pickFailure, setPickFailure] = useState<{ url: string; message: string } | null>(null);
  const [lookup] = useState(lookupProp);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    function load(from: CoverPickSource, set: (next: FoundCoversLoad) => void) {
      fetchCoverCandidates(lookup, from).then(
        (response) => current && set({ state: "done", response }),
        (error: unknown) => current && set({ state: "failed", message: errorMessage(error) })
      );
    }
    load("quick", setQuick);
    load("apple", setApple);
    return () => {
      current = false;
    };
  }, [lookup]);

  function measure(url: string, size: MeasuredCoverSize) {
    setMeasured((previous) => new Map(previous).set(url, size));
  }

  async function choose(candidate: CoverCandidateView, everyone: boolean) {
    setPicking(true);
    setPickFailure(null);
    try {
      const cover = await pickCover(lookup, candidate.coverImageId ? { coverImageId: candidate.coverImageId } : { url: candidate.url }, everyone);
      if (mounted.current) onPick(cover, everyone);
      else if (everyone) rememberResolvedCover(lookup, cover);
    } catch (error) {
      setPickFailure({ url: candidate.url, message: errorMessage(error) });
    } finally {
      setPicking(false);
    }
  }

  const { tiles, unavailable, failures, checkingApple, empty } = foundCoversView(quick, apple, measured);

  if (empty) return null;

  return (
    <section className="mb-4">
      <h3 className="mb-2 text-sm font-semibold">Found covers</h3>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {tiles.map(({ candidate, width, height }) => (
          <div key={candidate.url} className="flex flex-col">
            <button
              type="button"
              disabled={picking}
              aria-label={`Use this ${coverSourceLabel(candidate.source)} cover${width !== null && height !== null ? `, ${width} by ${height}` : ""}`}
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
                aria-label={`Use for everyone: ${coverSourceLabel(candidate.source)} cover`}
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
          <div role="status" className="flex aspect-square items-center justify-center rounded-lg border-2 border-transparent bg-(--color-border) p-2 text-center text-xs text-(--color-text-dim)">
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
