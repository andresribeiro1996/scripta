import type { LibraryData } from "../api/library";
import { EmptyState } from "./EmptyState";
import { BUTTON_SECONDARY } from "./page/buttonClasses";
import { PublicLibraryGrid } from "./PublicLibraryGrid";
import { SkeletonCardGrid } from "./Skeleton";
import { useT } from "../i18n";

export function ProfileLibraryPanel({ library, isLoading, error, onRetry, onOpenBook }: { library: LibraryData | null | undefined; isLoading: boolean; error: unknown; onRetry: () => void; onOpenBook?: (book: Record<string, unknown>) => void }) {
  const t = useT();
  if (isLoading) return <SkeletonCardGrid count={6} label={t("library.loadingLibrary")} tileClassName="aspect-[2/3]" />;
  if (error) {
    return (
      <EmptyState
        title={t("library.libraryLoadFailed")}
        action={
          <button onClick={onRetry} className={BUTTON_SECONDARY}>
            {t("library.retry")}
          </button>
        }
      />
    );
  }
  if (!library) return <p className="text-sm text-(--color-text-dim)">{t("library.emptyLibrary")}</p>;
  return <PublicLibraryGrid library={library} onOpenBook={onOpenBook} />;
}
