import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import type { DialGroup } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import type { Counter } from "./counters.js";
import { fitLine, textWidth, wrapLines } from "./fit.js";
import { PLATES, plateEpithet, plateName, type IdentityKey } from "./plates.js";
import type { ReaderCardBase, ReaderCardInput } from "./render.js";
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

export function turnToPage(state: TurnState, pages: readonly ReaderCardPage[], page: ReaderCardPage): TurnState {
  const index = [pages.indexOf(page), pages.indexOf("merged")].find((found) => found >= 0) ?? 1;
  return turnTo(state, index, index > state.index ? 1 : -1);
}

export function turnBy(state: TurnState, by: 1 | -1, count: number): TurnState {
  return turnTo(state, (state.index + by + count) % count, by);
}

const OWN = "◇";

const GROUP_KEYS = { lamp: "shared.readerCard.groupLamp", star: "shared.readerCard.groupStar", arch: "shared.readerCard.groupArch", corr: "shared.readerCard.groupCorr", other: "shared.readerCard.groupOther", unknown: "shared.readerCard.groupUnknown" } as const;

export const groupLabel = (group: DialGroup, locale: Locale) => sharedT(locale)(GROUP_KEYS[group]);

const LEGENDS = { dial: "shared.readerCard.legendDial", beads: "shared.readerCard.legendBeads", shelf: "shared.readerCard.legendShelf", frame: "shared.readerCard.legendFrame", ring: "shared.readerCard.legendRing" } as const satisfies Record<Counter, string>;

export interface Row { label: string; value: string; own: boolean }

export function recordRows(input: ReaderCardInput, compact: boolean): Row[] {
  const { card, locale } = input;
  const t = sharedT(locale);
  const segments = card.dial?.segments ?? [];
  const finished = card.facts?.finished ?? segments.reduce((sum, segment) => sum + segment.books, 0);
  const rows: Row[] = [];
  if (card.facts || segments.length) rows.push({ label: t("shared.readerCard.rowFinished"), value: String(finished), own: false });
  for (const segment of compact ? segments.slice(0, 1) : segments) {
    const share = segment.group === card.identity && finished > 0 ? ` · ${Math.round((segment.books / finished) * 100)}%` : "";
    rows.push({ label: groupLabel(segment.group, locale), value: `${segment.books}${share}`, own: false });
  }
  if (segments.length) rows.push({ label: t("shared.readerCard.rowHighlights"), value: String(segments.reduce((sum, segment) => sum + segment.marked, 0)), own: false });
  const second = card.state === "unwritten" ? null : card.streak ?? card.runnerUp;
  if (second) rows.push({ label: t("shared.readerCard.rowRunnerUp"), value: plateName(second, locale), own: false });
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

function subtitle(card: PublicReaderCard, locale: Locale): string {
  const t = sharedT(locale);
  if (card.state === "unwritten" || !card.identity) return t("shared.readerCard.subtitleUnwritten");
  const plate = PLATES.find((item) => item.key === card.identity)!;
  return t(card.state === "leaning" ? "shared.readerCard.subtitleLeaning" : "shared.readerCard.subtitlePlate", { name: plateName(plate.key, locale).toUpperCase(), numeral: plate.numeral });
}

export function recordBody(input: ReaderCardInput): string {
  const { card, locale } = input;
  const t = sharedT(locale);
  let out = svgText(125, 40, t("shared.readerCard.recordTitle"), { size: 8.5, spacing: 3.2, weight: 600 })
    + svgText(125, 52, fitLine(subtitle(card, locale), { font: "caps", size: 5.8, width: 190, spacing: 1.6 }), { size: 5.8, spacing: 1.6, weight: 600, opacity: 0.8 })
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
  if (card.dial?.segments.length) out += t(LEGENDS[input.style.counter]).split("\n").map((line, i) => svgText(125, 268 + i * 9, line, { size: 6.2, font: "serif", italic: true })).join("");
  return out + coverageLines(card.coverage);
}

export const COVER_URL = /^https:\/\/[^\s"'<>&\\]+$/;

type Signature = NonNullable<ReaderCardChosen["signature"]>;
type Highlight = NonNullable<ReaderCardChosen["highlight"]>;

export function cover(signature: Signature, x: number, y: number, w: number, h: number): string {
  const frame = `<rect class="pl" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" stroke-width=".4"/>`;
  if (signature.coverUrl && COVER_URL.test(signature.coverUrl)) {
    return `<rect class="pf" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2"/><image href="${signature.coverUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>${frame}`;
  }
  const s = w / 52;
  const title = wrapLines(signature.title.toUpperCase(), { font: "caps", size: 4.6 * s, width: w - 8, lines: 4 });
  const author = fitLine((signature.author.trim().split(/\s+/).pop() ?? "").toUpperCase(), { font: "caps", size: 3.6 * s, width: w - 8 });
  return `<rect class="pf" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2"/><rect class="pgs" x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" stroke-width=".4" opacity=".6"/>`
    + title.map((line, i) => svgText(x + w / 2, y + 20 * s + i * 6.5 * s, line, { size: 4.6 * s, weight: 700, cls: "pg" })).join("")
    + svgText(x + w / 2, y + h - 8 * s, author, { size: 3.6 * s, cls: "pg" });
}

function signatureBlock(signature: Signature, top: number, big: boolean, locale: Locale): { svg: string; bottom: number } {
  const [w, h] = big ? [76, 112] : [52, 77];
  let svg = svgText(125, top, sharedT(locale)("shared.readerCard.signatureTitle"), { size: 6.5, spacing: 2.6, weight: 600 }) + cover(signature, 125 - w / 2, top + 10, w, h);
  let y = top + 10 + h + 16;
  const title = wrapLines(signature.title, { font: "serif", size: 12, width: 190, lines: 2 });
  svg += title.map((line, i) => svgText(125, y + i * 14, line, { size: 12, font: "serif" })).join("");
  y += (title.length - 1) * 14 + 12;
  svg += svgText(125, y, fitLine(signature.author.toUpperCase(), { font: "caps", size: 5.8, width: 190, spacing: 1.4 }), { size: 5.8, spacing: 1.4, weight: 600 });
  if (signature.note) {
    const note = wrapLines(`“${signature.note}”`, { font: "serif", size: 7.5, width: 190, lines: 2 });
    svg += note.map((line, i) => svgText(125, y + 13 + i * 10, line, { size: 7.5, font: "serif", italic: true })).join("");
    y += 13 + (note.length - 1) * 10;
  }
  return { svg, bottom: y };
}

function highlightBlock(highlight: Highlight, top: number, size: number): string {
  const lines = wrapLines(`“${highlight.text}”`, { font: "serif", size, width: 190, lines: 4 });
  const attribution = top + (lines.length - 1) * (size + 4) + 14;
  return lines.map((line, i) => svgText(125, top + i * (size + 4), line, { size, font: "serif", italic: true })).join("")
    + svgText(125, attribution, fitLine(`${highlight.author} · ${highlight.title}`.toUpperCase(), { font: "caps", size: 5.2, width: 190, spacing: 1.2 }), { size: 5.2, spacing: 1.2, weight: 600, opacity: 0.85 });
}

const divider = (y: number) => `<path class="pl" d="M82 ${y}H117M133 ${y}H168" stroke-width=".8"/><circle class="pf" cx="125" cy="${y}" r="2"/>`;

export function chosenBody(input: ReaderCardInput): string {
  const { signature, highlight } = input.card.chosen ?? {};
  const t = sharedT(input.locale);
  if (signature && highlight) {
    const book = signatureBlock(signature, 38, false, input.locale);
    const y = book.bottom + 12;
    return book.svg + divider(y) + highlightBlock(highlight, y + 26, 11);
  }
  if (signature) return signatureBlock(signature, 52, true, input.locale).svg;
  if (highlight) return svgText(125, 120, "“", { size: 40, font: "serif", opacity: 0.3 }) + highlightBlock(highlight, 150, 13);
  if (input.view !== "owner") return "";
  return svgText(125, 40, t("shared.readerCard.chosenTitle"), { size: 6.5, spacing: 2.6, weight: 600 })
    + t("shared.readerCard.invitation").split("\n").map((line, i) => svgText(125, 150 + i * 15, line, { size: 11, font: "serif", italic: true })).join("");
}

export function mergedBody(input: ReaderCardInput): string {
  const { signature, highlight } = input.card.chosen ?? {};
  const t = sharedT(input.locale);
  let out = "";
  let y: number;
  if (signature || highlight) {
    let top = 30;
    if (signature) {
      out += cover(signature, 30, 30, 40, 59) + svgText(80, 44, t("shared.readerCard.signatureTitle"), { size: 5.4, spacing: 2, weight: 600, anchor: "start" });
      const title = wrapLines(signature.title, { font: "serif", size: 11, width: 140, lines: 2 });
      out += title.map((line, i) => svgText(80, 60 + i * 13, line, { size: 11, font: "serif", anchor: "start" })).join("");
      out += svgText(80, 60 + title.length * 13, fitLine(signature.author.toUpperCase(), { font: "caps", size: 5.4, width: 140, spacing: 1.3 }), { size: 5.4, spacing: 1.3, weight: 600, anchor: "start" });
      top = 104;
    }
    if (highlight) {
      const lines = wrapLines(`“${highlight.text}”`, { font: "serif", size: 9, width: 190, lines: 2 });
      out += lines.map((line, i) => svgText(125, top + 8 + i * 13, line, { size: 9, font: "serif", italic: true })).join("");
      const at = top + 8 + lines.length * 13 + 2;
      out += svgText(125, at, fitLine(`${highlight.author} · ${highlight.title}`.toUpperCase(), { font: "caps", size: 5, width: 190, spacing: 1.2 }), { size: 5, spacing: 1.2, weight: 600, opacity: 0.85 });
      top = at + 4;
    }
    y = top + 10;
  } else if (input.view === "owner") {
    out += t("shared.readerCard.invitationMerged").split("\n").map((line, i) => svgText(125, 44 + i * 12, line, { size: 9, font: "serif", italic: true })).join("");
    y = 70;
  } else {
    out += svgText(125, 40, t("shared.readerCard.recordTitle"), { size: 8.5, spacing: 3.2, weight: 600 });
    y = 52;
  }
  return out + rule(y, 0.9) + rule(y + 2.5, 0.4) + rowsSvg(recordRows(input, true), y + 18, 284, 7) + coverageLines(input.card.coverage);
}

export function readerCardSummary(input: ReaderCardBase): string[] {
  const { card, locale } = input;
  const t = sharedT(locale);
  const plate = card.identity && card.state !== "unwritten" ? PLATES.find((item) => item.key === card.identity) : undefined;
  const lines = [plate ? t(card.state === "leaning" ? "shared.readerCard.summaryLeaning" : "shared.readerCard.summaryPlate", { name: plateName(plate.key, locale), numeral: plate.numeral, epithet: plateEpithet(plate.key, locale) }) : t("shared.readerCard.summaryUnwritten")];
  if (input.style.motto) lines.push(t("shared.readerCard.summaryMotto", { text: input.style.motto.text }));
  const second = card.state === "unwritten" ? null : card.streak ?? null;
  if (second) lines.push(t("shared.readerCard.summaryStreak", { name: plateName(second, locale) }));
  if (card.signal) lines.push(`${card.signal.label}.`);
  const segments = card.dial?.segments ?? [];
  if (card.facts) {
    const groups = segments.map((segment) => `${segment.books} ${groupLabel(segment.group, locale).toLowerCase()}`).join(", ");
    const marked = segments.reduce((sum, segment) => sum + segment.marked, 0);
    lines.push(t(groups ? "shared.readerCard.summaryFinishedGroups" : "shared.readerCard.summaryFinished", { count: card.facts.finished, groups, marked }));
  }
  const { signature, highlight } = card.chosen ?? {};
  if (signature) lines.push(t(signature.note ? "shared.readerCard.summarySignatureNote" : "shared.readerCard.summarySignature", { title: signature.title, author: signature.author, note: signature.note ?? "" }));
  if (highlight) lines.push(t("shared.readerCard.summaryHighlight", { text: highlight.text, author: highlight.author, title: highlight.title }));
  if (input.view === "owner") {
    if (input.leaders?.length) lines.push(t("shared.readerCard.summaryOnlyYou", { text: input.leaders.map((leader) => `${leader.label} (${leader.count})`).join(", ") }));
    if (card.state === "leaning" && input.missing) lines.push(t("shared.readerCard.summaryOnlyYou", { text: input.missing }));
  }
  return [...lines, ...card.coverage];
}
