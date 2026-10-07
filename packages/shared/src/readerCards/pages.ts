import type { Layout, ReaderCardChosen } from "./style.js";

export type ReaderCardPage = "front" | "chosen" | "record" | "merged";
export type ReaderCardStep = ReaderCardPage | [ReaderCardPage, ReaderCardPage];
export type ReaderCardView = "owner" | "visitor";

export function hasChosen(chosen?: ReaderCardChosen): boolean {
  return Boolean(chosen?.signature || chosen?.highlight);
}

export function readerCardPages(layout: Layout, view: ReaderCardView, chosen: boolean): ReaderCardStep[] {
  if (layout === "merged") return ["front", "merged"];
  if (view === "visitor" && !chosen) return ["front", "record"];
  return layout === "book" ? ["front", ["chosen", "record"]] : ["front", "chosen", "record"];
}

export interface TurnState { index: number; rotation: number; faces: [number, number] }

export function startTurn(count: number): TurnState {
  return { index: 0, rotation: 0, faces: [0, count > 1 ? 1 : 0] };
}

export function turnTo(state: TurnState, to: number, direction: 1 | -1): TurnState {
  if (to === state.index) return state;
  const rotation = state.rotation + direction * 180;
  const showing = (((rotation / 180) % 2) + 2) % 2;
  const faces: [number, number] = [state.faces[0], state.faces[1]];
  faces[showing] = to;
  return { index: to, rotation, faces };
}

export function turnBy(state: TurnState, by: 1 | -1, count: number): TurnState {
  return turnTo(state, (state.index + by + count) % count, by);
}
