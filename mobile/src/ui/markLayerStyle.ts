import type { LayerEntrance } from "@scripta/shared/themes";

export function layerStyle(progress: number, enter: LayerEntrance | null, fadeIn: boolean, unit: number) {
  "worklet";
  return {
    opacity: fadeIn || enter?.fade ? progress : 1,
    transform: [{ translateX: enter ? (1 - progress) * enter.from[0] * unit : 0 }, { translateY: enter ? (1 - progress) * enter.from[1] * unit : 0 }],
  };
}
