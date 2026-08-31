// Persists a mural block's position through the per-block endpoint
// instead of re-sending the whole library.
//
// Before this, dropping a block called updateLibrary, which PUT the
// entire document — every book, every highlight, every group, every other
// mural — to move one box a few grid cells. On a large library that is
// megabytes over the wire per drop.
//
// Two things happen here:
//   1. The React Query cache is updated immediately, so the block stays
//      where the user put it without waiting for a round trip.
//   2. The network write is debounced per block, so rearranging several
//      blocks in quick succession coalesces into one write each rather
//      than one per intermediate position.

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { saveMuralBlockLayout, type LibraryDocument } from "../api/library";
import type { BlockLayout } from "../lib/murals";

/** How long to wait after the last drop before writing. Long enough to
 *  coalesce a quick rearrangement, short enough that a user who drags one
 *  block and immediately closes the tab has almost certainly been saved
 *  (and if not, the unmount flush below catches it). */
const DEBOUNCE_MS = 400;

export function useMuralBlockLayout(muralId: string | undefined) {
  const queryClient = useQueryClient();
  // One timer per block, so moving block A doesn't cancel block B's
  // pending save.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, BlockLayout>());

  const flush = useCallback(
    async (blockId: string) => {
      const layout = pending.current.get(blockId);
      if (!muralId || !layout) return;
      pending.current.delete(blockId);

      const currentVersion = queryClient.getQueryData<LibraryDocument>(["library"])?.version;

      try {
        const { version } = await saveMuralBlockLayout(muralId, blockId, layout, currentVersion);
        // Keep the cached version in step so the next write doesn't look
        // stale to the server.
        queryClient.setQueryData<LibraryDocument>(["library"], (previous) =>
          previous ? { ...previous, version } : previous
        );
      } catch (err) {
        // 409 (someone else saved) or 404 (the block was deleted on
        // another device) both mean this client's picture is out of date.
        // Re-read rather than guess — the drag is cheap to redo, silently
        // showing the wrong layout is not.
        if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
          await queryClient.invalidateQueries({ queryKey: ["library"] });
          return;
        }
        throw err;
      }
    },
    [muralId, queryClient]
  );

  const saveLayout = useCallback(
    (blockId: string, layout: BlockLayout) => {
      if (!muralId) return;

      // Optimistic: move it in the cache now, so the canvas doesn't snap
      // back while the write is in flight.
      queryClient.setQueryData<LibraryDocument>(["library"], (previous) => {
        if (!previous) return previous;
        const murals = previous.data.murals ?? [];
        return {
          ...previous,
          data: {
            ...previous.data,
            murals: murals.map((mural) =>
              mural.id === muralId
                ? { ...mural, blocks: mural.blocks.map((block) => (block.id === blockId ? { ...block, layout } : block)) }
                : mural
            )
          }
        };
      });

      pending.current.set(blockId, layout);
      const existing = timers.current.get(blockId);
      if (existing) clearTimeout(existing);
      timers.current.set(
        blockId,
        setTimeout(() => {
          timers.current.delete(blockId);
          void flush(blockId);
        }, DEBOUNCE_MS)
      );
    },
    [muralId, queryClient, flush]
  );

  // Navigating away mid-debounce must not drop the move. Fire whatever is
  // still pending on unmount.
  useEffect(() => {
    const timerMap = timers.current;
    return () => {
      for (const [blockId, timer] of timerMap) {
        clearTimeout(timer);
        void flush(blockId);
      }
      timerMap.clear();
    };
  }, [flush]);

  return saveLayout;
}
