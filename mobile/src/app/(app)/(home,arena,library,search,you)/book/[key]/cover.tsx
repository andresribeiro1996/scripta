import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { CoverPicker } from "@/features/library/components/CoverPicker";
import { coverParamsFor } from "@/features/library/components/CoverImage";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { fetchWork } from "@/features/works/api";
import { otherEditionCovers } from "@/features/works/bookPage";
import { ErrorState, Screen, SheetHeader, Skeleton } from "@/ui";

export default function BookCoverRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, loading, workId } = useBook(key);
  const workQuery = useQuery({ queryKey: ["works", workId], queryFn: () => fetchWork(workId!), enabled: Boolean(workId), retry: false });
  const editions = workQuery.data?.work.editions ?? [];
  const current = typeof book?._coverUrl === "string" ? book._coverUrl : (editions.find((edition) => edition.mine)?.coverUrl ?? null);
  const { saveBookCover, saveBookCoverUrl, removeBookCover } = useLibraryActions();
  const title = String(book?.Title ?? "");
  const sheetTitle = title ? `Cover for "${title}"` : "Cover";

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: sheetTitle, headerShown: false }} />
      <SheetHeader title={sheetTitle} onClose={() => router.back()} />
      {loading ? (
        <Skeleton height={180} />
      ) : !book ? (
        <ErrorState title="Book not found" actionLabel="Close" onAction={() => router.back()} />
      ) : (
        <CoverPicker
          title={title}
          currentImageId={typeof book._coverImageId === "string" ? book._coverImageId : null}
          lookup={coverParamsFor(book)}
          coverUrl={typeof book._coverUrl === "string" ? book._coverUrl : null}
          onSelect={(image) => void saveBookCover(book, image)}
          onPickFound={(cover) => {
            if (cover.fullUrl) void saveBookCoverUrl(book, cover.fullUrl);
            router.back();
          }}
          editionCovers={otherEditionCovers(editions, current)}
          onPickEdition={(url) => {
            void saveBookCoverUrl(book, url);
            router.back();
          }}
          onRemoveCover={() => void removeBookCover(book)}
          onClose={() => router.back()}
        />
      )}
    </Screen>
  );
}
