import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
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
  type ResolvedCoverResponse,
} from "@scripta/shared";
import { Text } from "../../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";
import { fetchCoverCandidates, pickCover, type ResolveCoverParams } from "../api/covers";

export function FoundCovers({
  lookup: lookupProp,
  coverUrl,
  onPick,
}: {
  lookup: ResolveCoverParams;
  coverUrl?: string | null;
  onPick: (cover: ResolvedCoverResponse) => void;
}) {
  const { colors } = useTheme();
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
        (error: unknown) => current && set({ state: "failed", message: errorMessage(error) }),
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

  async function choose(candidate: CoverCandidateView) {
    setPicking(true);
    setPickFailure(null);
    try {
      const cover = await pickCover(lookup, candidate.coverImageId ? { coverImageId: candidate.coverImageId } : { url: candidate.url });
      if (mounted.current) onPick(cover);
    } catch (error) {
      setPickFailure({ url: candidate.url, message: errorMessage(error) });
    } finally {
      setPicking(false);
    }
  }

  const { tiles, unavailable, failures, checkingApple, empty } = foundCoversView(quick, apple, measured);

  if (empty) return null;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typography.body, { color: colors.text, fontWeight: "600" }]}>
        Found covers
      </Text>
      <View style={styles.grid}>
        {tiles.map(({ candidate, width, height }, index) => {
          const label = coverSourceLabel(candidate.source);
          const size = width !== null && height !== null ? { width, height } : null;
          const current = isCurrentCover(candidate, coverUrl);
          return (
            <View key={candidate.url} style={styles.cell}>
              <Pressable
                accessibilityLabel={`Use this ${label} cover, ${size ? `${size.width} by ${size.height}, ` : ""}${index + 1} of ${tiles.length}`}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                disabled={picking}
                onPress={() => void choose(candidate)}
                style={[
                  styles.thumb,
                  { borderColor: current ? colors.accent : "transparent", backgroundColor: colors.border, opacity: picking ? 0.55 : 1 },
                ]}
              >
                <Image
                  source={{ uri: candidate.url }}
                  style={styles.thumbImage}
                  contentFit="contain"
                  allowDownscaling={false}
                  onLoad={(e) => measure(candidate.url, { width: e.source.width, height: e.source.height })}
                  onError={() => measure(candidate.url, null)}
                />
              </Pressable>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {size && <Text style={[typography.caption, { color: colors.textDim }]}>{`${size.width} × ${size.height}`}</Text>}
                <Text style={[typography.caption, { color: colors.textDim }]}>{label}</Text>
              </View>
              {pickFailure?.url === candidate.url && (
                <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>
                  {pickFailure.message}
                </Text>
              )}
            </View>
          );
        })}
        {checkingApple && (
          <View style={[styles.cell, styles.thumb, styles.checking, { borderColor: "transparent", backgroundColor: colors.border }]}>
            <Text style={[typography.caption, { color: colors.textDim, textAlign: "center" }]}>Checking Apple Books…</Text>
          </View>
        )}
      </View>
      {unavailable.map((name) => (
        <Text key={name} style={[typography.caption, { color: colors.textDim }]}>{`${coverSourceLabel(name)} didn't answer.`}</Text>
      ))}
      {failures.map((message) => (
        <Text key={message} style={[typography.caption, { color: colors.danger }]}>
          {message}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cell: { width: "31%" },
  thumb: { aspectRatio: 1, borderRadius: radii.md, borderWidth: 2, overflow: "hidden", minHeight: minimumTouchTarget },
  thumbImage: { flex: 1 },
  checking: { alignItems: "center", justifyContent: "center", padding: spacing.sm },
});
