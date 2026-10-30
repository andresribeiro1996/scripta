import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import {
  coverQueryKey,
  coverSourceLabel,
  isCurrentCover,
  visibleCandidates,
  type CoverCandidatesResponse,
  type CoverCandidateView,
  type CoverPickSource,
  type ResolvedCoverResponse,
} from "@scripta/shared";
import { Text } from "../../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";
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
  onPick,
}: {
  lookup: ResolveCoverParams;
  coverUrl?: string | null;
  onPick: (cover: ResolvedCoverResponse) => void;
}) {
  const { colors } = useTheme();
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
        (error: unknown) => current && set({ state: "failed", message: messageOf(error) }),
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

  async function choose(candidate: CoverCandidateView) {
    setPicking(true);
    setPickFailure(null);
    try {
      onPick(await pickCover(lookup, candidate.coverImageId ? { coverImageId: candidate.coverImageId } : { url: candidate.url }));
    } catch (error) {
      setPickFailure({ url: candidate.url, message: messageOf(error) });
    } finally {
      setPicking(false);
    }
  }

  const loads = [quick, apple];
  const tiles = visibleCandidates(
    loads.flatMap((load) => (load.state === "done" ? load.response.candidates : [])),
    measured,
  );
  const unavailable = [...new Set(loads.flatMap((load) => (load.state === "done" ? load.response.unavailable : [])))];
  const failures = [...new Set(loads.flatMap((load) => (load.state === "failed" ? [load.message] : [])))];
  const checkingApple = apple.state === "pending";

  if (tiles.length === 0 && unavailable.length === 0 && failures.length === 0 && !checkingApple) return null;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typography.body, { color: colors.text, fontWeight: "600" }]}>
        Found covers
      </Text>
      <View style={styles.grid}>
        {tiles.map(({ candidate, width, height }) => {
          const label = coverSourceLabel(candidate.source);
          const size = width !== null && height !== null ? { width, height } : null;
          const current = isCurrentCover(candidate, coverUrl);
          return (
            <View key={candidate.url} style={styles.cell}>
              <Pressable
                accessibilityLabel={size ? `${label} cover, ${size.width} by ${size.height}` : `${label} cover`}
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
                  onLoad={(e) => measure(candidate.url, { width: e.source.width, height: e.source.height })}
                  onError={() => measure(candidate.url, null)}
                />
              </Pressable>
              {size && <Text style={[typography.caption, { color: colors.textDim }]}>{`${size.width} × ${size.height}`}</Text>}
              <Text style={[typography.caption, { color: colors.textDim }]}>{label}</Text>
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
