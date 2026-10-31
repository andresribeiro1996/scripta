import type { LibraryData } from "../api/library";
import { EmptyState } from "./EmptyState";
import { BUTTON_SECONDARY } from "./page/buttonClasses";
import { PublicLibraryGrid } from "./PublicLibraryGrid";
import { SkeletonCardGrid } from "./Skeleton";

export function ProfileLibraryPanel({ library, isLoading, error, onRetry }: { library: LibraryData | null | undefined; isLoading: boolean; error: unknown; onRetry: () => void }) {
  if (isLoading) return <SkeletonCardGrid count={6} label="Loading library" tileClassName="aspect-[2/3]" />;
  if (error) {
    return (
      <EmptyState
        title="Couldn't load this library."
        action={
          <button onClick={onRetry} className={BUTTON_SECONDARY}>
            Retry
          </button>
        }
      />
    );
  }
  if (!library) return <p className="text-sm text-(--color-text-dim)">This library is empty.</p>;
  return <PublicLibraryGrid library={library} />;
}
