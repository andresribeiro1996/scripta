// Mirrors frontend's BookCard.tsx CoverImage — `book._coverUrl` first (a
// genuine custom gallery cover, see @scripta/shared's bookCovers.ts),
// otherwise one memoized call to the backend's cache-aware
// GET /covers/resolve (see ../api/covers.ts). expo-image disk-caches by
// default (Task 4D's own note), so this doesn't need its own on-disk
// cache on top of the URL memoization already in api/covers.ts.

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { normalizeImageId, normalizeIsbn } from "@scripta/shared";
import { useTheme } from "../../../ui/theme";
import { ensureCoversHydrated, forgetResolvedCover, peekResolvedCover, resolveCover, type ResolveCoverParams } from "../api/covers";

function coverParamsFor(book: Record<string, unknown>): ResolveCoverParams {
  const isbn = normalizeIsbn(book.ISBN);
  const imageId = normalizeImageId(book.ImageId);
  const title = String(book.Title ?? "").trim();
  return {
    isbn: isbn || undefined,
    imageId: imageId || undefined,
    title: title || undefined,
    author: book.Attribution ? String(book.Attribution) : undefined,
  };
}

export function CoverImage({
  book,
  onHasCoverChange,
  contentFit = "cover",
}: {
  book: Record<string, unknown>;
  onHasCoverChange?: (hasCover: boolean) => void;
  contentFit?: "cover" | "contain";
}) {
  const { colors } = useTheme();
  const confirmedUrl = typeof book._coverUrl === "string" ? book._coverUrl : null;
  const [confirmedFailed, setConfirmedFailed] = useState(false);
  const [autoUrl, setAutoUrl] = useState<string | null>(() => peekResolvedCover(coverParamsFor(book)) ?? null);
  const useAuto = !confirmedUrl || confirmedFailed;

  useEffect(() => {
    setConfirmedFailed(false);
    setAutoUrl(peekResolvedCover(coverParamsFor(book)) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, confirmedUrl]);

  useEffect(() => {
    if (!useAuto) return;
    const params = coverParamsFor(book);
    if (!params.isbn && !params.imageId && !params.title) return;
    let cancelled = false;
    void (async () => {
      await ensureCoversHydrated();
      const cached = peekResolvedCover(params);
      if (cached !== undefined) {
        if (!cancelled) setAutoUrl(cached);
        return;
      }
      try {
        const url = await resolveCover(params);
        if (!cancelled) setAutoUrl(url);
      } catch {
        if (!cancelled) setAutoUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useAuto, book]);

  const currentSrc = useAuto ? autoUrl : confirmedUrl;
  const hasCover = Boolean(currentSrc);

  useEffect(() => {
    onHasCoverChange?.(hasCover);
  }, [hasCover, onHasCoverChange]);

  if (!currentSrc) {
    return <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colors.border }]} />;
  }

  return (
    <Image
      source={{ uri: currentSrc }}
      style={StyleSheet.absoluteFill}
      contentFit={contentFit}
      transition={150}
      onError={() => {
        if (!useAuto) setConfirmedFailed(true);
        else {
          forgetResolvedCover(coverParamsFor(book));
          setAutoUrl(null);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: "center", justifyContent: "center" },
});
