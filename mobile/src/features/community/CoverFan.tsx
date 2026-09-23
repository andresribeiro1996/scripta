import { StyleSheet } from "react-native";
import { Image } from "expo-image";
import { radii } from "../../ui";

const COVER_WIDTH = 42;
const COVER_HEIGHT = 64;
const COVER_STEP = 15;
const COVER_RISE = 4;
// The fan starts inset rather than at the slot's edge, which buys the badge
// room on the left: it then sits on the same edge as the avatar a follow or
// a vote row shows, so every row in the feed starts on one line.
const COVER_INSET = 14;
export const SLOT_WIDTH = COVER_INSET + COVER_WIDTH + COVER_STEP * 2;
export const SLOT_HEIGHT = COVER_HEIGHT + COVER_RISE * 2;

export function CoverFan({ covers }: { covers: string[] }) {
  return covers.map((cover, index) => (
    <Image
      key={`${index}:${cover}`}
      source={{ uri: cover }}
      contentFit="cover"
      style={[styles.cover, { left: COVER_INSET + index * COVER_STEP, top: (covers.length - 1 - index) * COVER_RISE, zIndex: index }]}
    />
  ));
}

const styles = StyleSheet.create({
  cover: { position: "absolute", width: COVER_WIDTH, height: COVER_HEIGHT, borderRadius: radii.sm },
});
