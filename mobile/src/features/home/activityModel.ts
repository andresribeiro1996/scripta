import { PERSONAL_DIGEST_KINDS, participationLead, type DigestItem } from "@scripta/shared";
import { feedEventLabel, feedPrimaryLabel } from "./feedRowModel";

export type PersonalItem = Extract<DigestItem, { kind: (typeof PERSONAL_DIGEST_KINDS)[number] }>;
export type ActivityAction = { kind: "followBack" } | { kind: "following" } | { kind: "open"; label: string };
export interface ActivityRowModel { lead: string; verb: string; target: string; action: ActivityAction }

export function isPersonalItem(item: DigestItem): item is PersonalItem {
  return (PERSONAL_DIGEST_KINDS as readonly string[]).includes(item.kind);
}

export function activityRowModel(item: PersonalItem): ActivityRowModel {
  if (item.kind === "follow") return { lead: item.actor.username, verb: feedEventLabel(item), target: "", action: item.viewerFollows ? { kind: "following" } : { kind: "followBack" } };
  if (item.kind === "participation") return { lead: participationLead(item), verb: feedEventLabel(item), target: item.game.name, action: { kind: "open", label: feedPrimaryLabel(item)! } };
  return { lead: "", verb: `${feedEventLabel(item)}:`, target: item.tournament.name, action: { kind: "open", label: feedPrimaryLabel(item)! } };
}

export function activitySentence(row: ActivityRowModel): string {
  return [row.lead, row.verb, row.target].filter(Boolean).join(" ");
}
