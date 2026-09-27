// Mirrors frontend's BookCard.tsx CoverImage — `book._coverUrl` first (a
// genuine custom gallery cover, see @scripta/shared's bookCovers.ts),
// otherwise one memoized call to the backend's cache-aware
// GET /covers/resolve (see ../api/covers.ts). expo-image disk-caches by
// default (Task 4D's own note), so this doesn't need its own on-disk
// cache on top of the URL memoization already in api/covers.ts.

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { normalizeImageId, normalizeIsbn, type CoverSize } from "@scripta/shared";
import { useTheme } from "../../../ui/theme";
import { API_URL } from "../../../core/config";
import { coverUrlForApi } from "../lib/coverUrl";
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
  onLoadEnd,
  contentFit = "cover",
  size = "thumb",
}: {
  book: Record<string, unknown>;
  onHasCoverChange?: (hasCover: boolean) => void;
  onLoadEnd?: () => void;
  contentFit?: "cover" | "contain";
  size?: CoverSize;
}) {
  const { colors } = useTheme();
  const confirmedUrl = typeof book._coverUrl === "string" ? book._coverUrl : null;
  const [confirmedFailed, setConfirmedFailed] = useState(false);
  const [autoUrl, setAutoUrl] = useState<string | null>(() => peekResolvedCover(coverParamsFor(book), size) ?? null);
  const [resolving, setResolving] = useState(() => peekResolvedCover(coverParamsFor(book), size) === undefined);
  const useAuto = !confirmedUrl || confirmedFailed;

  useEffect(() => {
    setConfirmedFailed(false);
    const cached = peekResolvedCover(coverParamsFor(book), size);
    setAutoUrl(cached ?? null);
    setResolving(cached === undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, confirmedUrl, size]);

  useEffect(() => {
    if (!useAuto) return;
    const params = coverParamsFor(book);
    if (!params.isbn && !params.imageId && !params.title) { setResolving(false); return; }
    let cancelled = false;
    void (async () => {
      try {
        await ensureCoversHydrated();
        const cached = peekResolvedCover(params, size);
        if (cached !== undefined) {
          if (!cancelled) { setAutoUrl(cached); setResolving(false); }
          return;
        }
        const url = await resolveCover(params, { size, poll: !onLoadEnd });
        if (!cancelled) { setAutoUrl(url); setResolving(false); }
      } catch {
        if (!cancelled) { setAutoUrl(null); setResolving(false); }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useAuto, book, size]);

  const currentSrc = useAuto ? autoUrl : confirmedUrl;
  const hasCover = Boolean(currentSrc);

  useEffect(() => {
    onHasCoverChange?.(hasCover);
  }, [hasCover, onHasCoverChange]);

  useEffect(() => {
    if (useAuto && !currentSrc && !resolving) onLoadEnd?.();
  }, [useAuto, currentSrc, resolving, onLoadEnd]);

  if (!currentSrc) {
    return <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colors.border }]}>{onLoadEnd && !resolving ? <Text style={{ color: colors.textDim, fontSize: 11, textAlign: "center" }}>Cover unavailable</Text> : null}</View>;
  }

  return (
    <Image
      source={{ uri: coverUrlForApi(currentSrc, API_URL) }}
      style={StyleSheet.absoluteFill}
      contentFit={contentFit}
      transition={onLoadEnd ? 0 : 150}
      onDisplay={onLoadEnd}
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
