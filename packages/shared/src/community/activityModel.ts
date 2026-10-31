import { PERSONAL_DIGEST_KINDS, participationLead, type DigestItem } from "../dashboard.js";
import type { Locale } from "../i18n/locale.js";
import { feedEventLabel, feedPrimaryLabel } from "./feedRowModel.js";

export type PersonalItem = Extract<DigestItem, { kind: (typeof PERSONAL_DIGEST_KINDS)[number] }>;
export type ActivityAction = { kind: "followBack" } | { kind: "following" } | { kind: "open"; label: string };
export interface ActivityRowModel { lead: string; verb: string; target: string; action: ActivityAction }

export function isPersonalItem(item: DigestItem): item is PersonalItem {
  return (PERSONAL_DIGEST_KINDS as readonly string[]).includes(item.kind);
}

export function activityRowModel(item: PersonalItem, locale: Locale): ActivityRowModel {
  if (item.kind === "follow") return { lead: item.actor.username, verb: feedEventLabel(item, locale), target: "", action: item.viewerFollows ? { kind: "following" } : { kind: "followBack" } };
  if (item.kind === "participation") return { lead: participationLead(item, locale), verb: feedEventLabel(item, locale), target: item.game.name, action: { kind: "open", label: feedPrimaryLabel(item, locale)! } };
  return { lead: "", verb: `${feedEventLabel(item, locale)}:`, target: item.tournament.name, action: { kind: "open", label: feedPrimaryLabel(item, locale)! } };
}

export function activitySentence(row: ActivityRowModel): string {
  return [row.lead, row.verb, row.target].filter(Boolean).join(" ");
}
