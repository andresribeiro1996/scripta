import type { DialGroup } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import type { Counter } from "./counters.js";
import { fitLine, textWidth, wrapLines } from "./fit.js";
import { PLATES, type IdentityKey } from "./plates.js";
import type { ReaderCardInput } from "./render.js";
import type { Layout, ReaderCardChosen } from "./style.js";
import { rule, svgText } from "./svgText.js";

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

const OWN = "◇";

export const GROUP_LABELS: Record<DialGroup, string> = { lamp: "Mystery & crime", star: "Fantasy & SF", arch: "History & memoir", corr: "Classics & literary", other: "Other genres", unknown: "Genre unknown" };

const LEGENDS: Record<Counter, [string, string]> = {
  dial: ["the dial: one mark per finished book;", "long marks carry highlights"],
  beads: ["the beads: one per finished book;", "filled beads carry highlights"],
  shelf: ["the shelf: one spine per finished book;", "banded spines carry highlights"],
  frame: ["the frame: one tick per finished book;", "long ticks carry highlights"],
  ring: ["the ring: one arc per genre,", "sized by its share of the books"],
};

const nameOf = (key: IdentityKey) => PLATES.find((plate) => plate.key === key)!.name;

export interface Row { label: string; value: string; own: boolean }

export function recordRows(input: ReaderCardInput, compact: boolean): Row[] {
  const { card } = input;
  const segments = card.dial?.segments ?? [];
  const finished = card.facts?.finished ?? segments.reduce((sum, segment) => sum + segment.books, 0);
  const rows: Row[] = [];
  if (card.facts || segments.length) rows.push({ label: "Finished", value: String(finished), own: false });
  for (const segment of compact ? segments.slice(0, 1) : segments) {
    const share = segment.group === card.identity && finished > 0 ? ` · ${Math.round((segment.books / finished) * 100)}%` : "";
    rows.push({ label: GROUP_LABELS[segment.group], value: `${segment.books}${share}`, own: false });
  }
  if (segments.length) rows.push({ label: "With highlights", value: String(segments.reduce((sum, segment) => sum + segment.marked, 0)), own: false });
  const second = card.state === "unwritten" ? null : card.streak ?? card.runnerUp;
  if (second) rows.push({ label: "Runner-up", value: nameOf(second), own: false });
  if (input.view === "owner") for (const leader of input.leaders ?? []) rows.push({ label: `${OWN} ${leader.label}`, value: String(leader.count), own: true });
  return rows;
}

export function rowsSvg(rows: Row[], top: number, bottom: number, size: number): string {
  const pitch = rows.length > 1 ? Math.min(16, (bottom - top) / (rows.length - 1)) : 0;
  return rows.map((row, i) => {
    const y = top + i * pitch;
    const opacity = row.own ? 0.7 : undefined;
    const value = fitLine(row.value, { font: "mono", size, width: 70 });
    const label = fitLine(row.label, { font: "mono", size, width: 182 - textWidth(value, { font: "mono", size }) });
    return svgText(30, y, label, { size, font: "mono", anchor: "start", opacity })
      + svgText(220, y, value, { size, font: "mono", anchor: "end", opacity })
      + rule(y + 4, 0.4, ` stroke-dasharray=".6 1.8" opacity=".6"`);
  }).join("");
}

export function coverageLines(coverage: string[]): string {
  if (!coverage.length) return "";
  const lines = wrapLines(coverage.join("; "), { font: "serif", size: 6, width: 190, lines: 2 });
  return lines.map((line, i) => svgText(125, 298 - (lines.length - 1 - i) * 8, line, { size: 6, font: "serif", italic: true, opacity: 0.75 })).join("");
}

function subtitle(card: PublicReaderCard): string {
  if (card.state === "unwritten" || !card.identity) return "UNWRITTEN";
  const plate = PLATES.find((item) => item.key === card.identity)!;
  return `${card.state === "leaning" ? "LEANING TOWARD" : "THE"} ${plate.name.toUpperCase()} · PLATE ${plate.numeral}`;
}

export function recordBody(input: ReaderCardInput): string {
  const { card } = input;
  let out = svgText(125, 40, "READER’S RECORD", { size: 8.5, spacing: 3.2, weight: 600 })
    + svgText(125, 52, fitLine(subtitle(card), { font: "caps", size: 5.8, width: 190, spacing: 1.6 }), { size: 5.8, spacing: 1.6, weight: 600, opacity: 0.8 })
    + rule(59, 0.9) + rule(61.5, 0.4);
  let top = 80;
  if (card.signal) {
    const lines = wrapLines(card.signal.label, { font: "serif", size: 6.6, width: 190, lines: 2 });
    out += lines.map((line, i) => svgText(125, 73 + i * 8, line, { size: 6.6, font: "serif", italic: true })).join("");
    top = 73 + lines.length * 8 + 10;
  }
  const missing = input.view === "owner" && card.state === "leaning" && input.missing ? wrapLines(`${OWN} ${input.missing}`, { font: "serif", size: 6.4, width: 190, lines: 2 }) : [];
  const bottom = 250 - (missing.length ? missing.length * 8 + 6 : 0);
  out += rowsSvg(recordRows(input, false), top, bottom, 7.2);
  out += missing.map((line, i) => svgText(30, bottom + 12 + i * 8, line, { size: 6.4, font: "serif", italic: true, anchor: "start", opacity: 0.7 })).join("");
  if (card.dial?.segments.length) out += LEGENDS[input.style.counter].map((line, i) => svgText(125, 268 + i * 9, line, { size: 6.2, font: "serif", italic: true })).join("");
  return out + coverageLines(card.coverage);
}
