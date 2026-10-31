import { itemNoun } from "../characters/index.js";
import { intlLocale, type Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { DEFAULT_TIER_PRESET } from "../tierlists/tierlist.js";
import type {
  ActivityEventType,
  ActivityItem,
  FeedCategory,
  FeedSettings,
  FeedItem,
  PersonResult,
  PublishedContent,
  RankingTierPreview,
  SuggestedReader
} from "./types.js";

const CONTENT_KINDS: Record<PublishedContent["kind"], true> = { tierlist: true, tournament: true, quiz: true };

export const TIER_LADDER = DEFAULT_TIER_PRESET.map((tier) => tier.color);

export function gameActionLabel(content: PublishedContent, locale: Locale): string {
  const t = sharedT(locale);
  if (content.kind === "quiz") return t(content.playOpen && !content.viewerVoted ? "shared.helpers.playQuiz" : "shared.helpers.viewQuiz");
  if (content.kind === "tournament") return t(content.status === "completed" ? "shared.helpers.viewResults" : "shared.helpers.voteInTournament");
  if (content.promotedAt || !content.votingOpen) return t("shared.helpers.viewRankings");
  if (content.viewerVoted) return t("shared.helpers.editRanking");
  return t(content.subject ? "shared.helpers.rankCharacters" : "shared.helpers.rankBooks");
}

export function isKnownContent(content: PublishedContent): boolean {
  return CONTENT_KINDS[content?.kind] === true;
}

export function contentKindLabel(content: PublishedContent, locale: Locale): string {
  const t = sharedT(locale);
  switch (content.kind) {
    case "tierlist":
      return t("shared.helpers.kindTierlist");
    case "tournament":
      return t("shared.helpers.kindTournament");
    case "quiz":
      return t("shared.helpers.kindQuiz");
  }
}

export function contentDetail(content: PublishedContent, locale: Locale): string {
  const t = sharedT(locale);
  switch (content.kind) {
    case "tierlist":
      return [
        t(content.subject ? "shared.helpers.characters" : "shared.helpers.books", { count: content.poolSize }),
        t("shared.helpers.ballots", { count: content.ballotCount }),
        ...(content.promotedAt ? [t("shared.helpers.permanentReference")] : content.votingOpen ? [] : [t("shared.helpers.closed")])
      ].join(" · ");
    case "tournament":
      return [
        t(content.subject ? "shared.helpers.bracketCharacters" : "shared.helpers.bracketBooks", { size: content.bracketSize }),
        t(content.status === "active" ? "shared.helpers.detailActive" : "shared.helpers.detailCompleted")
      ].join(" · ");
    case "quiz":
      return [
        t("shared.helpers.questions", { count: content.questionCount }),
        t("shared.helpers.plays", { count: content.playCount }),
        ...(content.playOpen ? [] : [t("shared.helpers.closed")])
      ].join(" · ");
  }
}

export type ContentTone = "neutral" | "accent" | "info" | "success" | "reference";

const CONTENT_STATUS = {
  draft: { key: "shared.helpers.statusDraft", tone: "neutral" },
  inProgress: { key: "shared.helpers.statusInProgress", tone: "info" },
  completed: { key: "shared.helpers.statusCompleted", tone: "success" },
  votingOpen: { key: "shared.helpers.statusVotingOpen", tone: "accent" },
  open: { key: "shared.helpers.statusOpen", tone: "accent" },
  closed: { key: "shared.helpers.statusClosed", tone: "neutral" },
  reference: { key: "shared.helpers.statusReference", tone: "reference" },
  voted: { key: "shared.helpers.statusVoted", tone: "info" },
  played: { key: "shared.helpers.statusPlayed", tone: "info" }
} as const satisfies Record<string, { key: Parameters<ReturnType<typeof sharedT>>[0]; tone: ContentTone }>;

export type ContentStatusName = keyof typeof CONTENT_STATUS;

export function contentStatusBadge(name: ContentStatusName, locale: Locale): { label: string; tone: ContentTone } {
  return { label: sharedT(locale)(CONTENT_STATUS[name].key), tone: CONTENT_STATUS[name].tone };
}

export function ownedTierlistStatus(tierlist: { promotedAt: string | null; voteCode: string | null; votingOpen: boolean }, locale: Locale): { label: string; tone: ContentTone } {
  if (tierlist.promotedAt) return contentStatusBadge("reference", locale);
  if (tierlist.voteCode === null) return contentStatusBadge("draft", locale);
  return contentStatusBadge(tierlist.votingOpen ? "votingOpen" : "closed", locale);
}

export function contentStatus(content: PublishedContent, locale: Locale): { label: string; tone: ContentTone; votedBadge?: boolean } {
  switch (content.kind) {
    case "tournament": {
      const base = contentStatusBadge(content.status === "active" ? "inProgress" : "completed", locale);
      // Tier lists fold the vote into the status itself ("Voted"); a tournament's
      // status still matters after voting, so it travels as a second badge.
      return content.viewerVoted ? { ...base, votedBadge: true } : base;
    }
    case "tierlist":
      if (content.promotedAt) return contentStatusBadge("reference", locale);
      if (content.votingOpen && content.viewerVoted) return contentStatusBadge("voted", locale);
      return contentStatusBadge(content.votingOpen ? "votingOpen" : "closed", locale);
    case "quiz":
      if (content.playOpen && content.viewerVoted) return contentStatusBadge("played", locale);
      return contentStatusBadge(content.playOpen ? "open" : "closed", locale);
  }
}

export function contentStats(content: PublishedContent, locale: Locale): Array<{ value: number; label: string }> {
  const t = sharedT(locale);
  switch (content.kind) {
    case "tierlist":
      return [
        { value: content.poolSize, label: itemNoun(content.subject, content.poolSize, locale) },
        { value: content.ballotCount, label: t("shared.helpers.ballotNoun", { count: content.ballotCount }) }
      ];
    case "tournament":
      return [{ value: content.bracketSize, label: itemNoun(content.subject, content.bracketSize, locale) }];
    case "quiz":
      return [
        { value: content.questionCount, label: t("shared.helpers.questionNoun", { count: content.questionCount }) },
        { value: content.playCount, label: t("shared.helpers.playNoun", { count: content.playCount }) }
      ];
  }
}

export function contentTarget(content: PublishedContent): string {
  switch (content.kind) {
    case "tierlist":
      return `/vote/${content.voteCode}`;
    case "tournament":
      return `/arena/${content.id}`;
    case "quiz":
      return `/play/${content.voteCode}`;
  }
}

export function feedTarget(item: FeedItem): string {
  return contentTarget(item.content);
}

export function feedAction(item: FeedItem, locale: Locale): string {
  const t = sharedT(locale);
  switch (item.content.kind) {
    case "tierlist":
      return t("shared.helpers.feedTierlist");
    case "tournament":
      return t("shared.helpers.feedTournament");
    case "quiz":
      return t("shared.helpers.feedQuiz");
  }
}

export function feedHeading(item: FeedItem, locale: Locale): string {
  return `${item.actor.username} ${feedAction(item, locale)}`;
}

export const DEFAULT_FEED_SETTINGS: FeedSettings = {
  publications: true,
  reading: false,
  votes: true,
  follows: true,
  readerGlyph: false
};

export function normalizeFeedSettings(value: unknown): FeedSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const keys: FeedCategory[] = ["publications", "reading", "votes", "follows"];
  const out: Partial<FeedSettings> = {};
  for (const k of keys) {
    if (typeof v[k] !== "boolean") return null;
    out[k] = v[k] as boolean;
  }
  if (typeof v.readerGlyph === "boolean") out.readerGlyph = v.readerGlyph;
  return out as FeedSettings;
}

export function categoryFor(type: ActivityEventType): FeedCategory {
  if (type === "book_added" || type === "book_started" || type === "book_finished") return "reading";
  if (type === "voted_on") return "votes";
  if (type === "following") return "follows";
  return "publications";
}

export function parseRankingPreview(value: unknown): RankingTierPreview[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const tier = entry as Record<string, unknown>;
    if (typeof tier.label !== "string" || typeof tier.color !== "string" || !/^#[\da-f]{6}$/i.test(tier.color) || !Array.isArray(tier.books)) return [];
    const books = tier.books.slice(0, 2).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const book = entry as Record<string, unknown>;
      return typeof book.title === "string" ? [{ title: book.title, coverUrl: typeof book.coverUrl === "string" ? book.coverUrl : null }] : [];
    });
    return books.length ? [{ label: tier.label, color: tier.color, books }] : [];
  });
}

export interface ActivityRow {
  kind: "publication" | "vote" | "reading" | "follow" | "mural";
  label: string;
  tone: "accent" | "success" | "dim";
  title: string;
  meta: string;
  covers: string[];
  href: string | null;
  username: string | null;
  workId: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function covers(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((cover): cover is string => typeof cover === "string" && cover.length > 0).slice(0, 3) : [];
}

function readStatus(status: number, locale: Locale): string {
  return sharedT(locale)(status === 2 ? "shared.helpers.readFinished" : status === 1 ? "shared.helpers.readReading" : "shared.helpers.readToRead");
}

export function activityRow(item: ActivityItem, locale: Locale): ActivityRow | null {
  const t = sharedT(locale);
  const p = item.payload;
  const base = { covers: covers(p.covers), href: text(p.href) || null, username: null, workId: null };
  switch (item.type) {
    case "tierlist_published":
      return { ...base, kind: "publication", label: t("shared.helpers.activityPublishedTierlist"), tone: "accent", title: text(p.name), meta: text(p.detail) };
    case "tournament_published":
      return { ...base, kind: "publication", label: t("shared.helpers.activityStartedTournament"), tone: "accent", title: text(p.name), meta: text(p.detail) };
    case "quiz_published":
      return { ...base, kind: "publication", label: t("shared.helpers.activityPublishedQuiz"), tone: "accent", title: text(p.name), meta: text(p.detail) };
    case "book_added": {
      const cover = text(p.coverUrl);
      return { ...base, kind: "reading", label: t(p.started === true ? "shared.helpers.activityStartedReading" : "shared.helpers.activityAddedToLibrary"), tone: "dim", title: text(p.title), meta: [text(p.author), readStatus(Number(p.status ?? 0), locale)].filter(Boolean).join(" · "), covers: cover ? [cover] : [], workId: text(p.workId) || null };
    }
    case "book_started":
    case "book_finished": {
      const cover = text(p.coverUrl);
      return { ...base, kind: "reading", label: t(item.type === "book_finished" ? "shared.helpers.activityFinishedReading" : "shared.helpers.activityStartedReading"), tone: item.type === "book_finished" ? "success" : "dim", title: text(p.title), meta: text(p.author), covers: cover ? [cover] : [], workId: text(p.workId) || null };
    }
    case "following":
      return { ...base, kind: "follow", label: t("shared.helpers.activityFollowed"), tone: "dim", title: `@${text(p.username)}`, meta: "", username: text(p.username) || null };
    case "mural_published":
      return { ...base, kind: "mural", label: t("shared.helpers.activityUpdatedProfile"), tone: "accent", title: t("shared.helpers.activityPublishedMural"), meta: "" };
    case "voted_on":
      return { ...base, kind: "vote", label: t(p.game === "tierlist" ? "shared.helpers.activityRankedTierlist" : p.game === "quiz" ? "shared.helpers.activityPlayedQuiz" : "shared.helpers.activityVotedTournament"), tone: "accent", title: text(p.name), meta: "" };
    default:
      return null;
  }
}

const DAY_MS = 86_400_000;

const SHORT_MONTHS = ["shortJan", "shortFeb", "shortMar", "shortApr", "shortMay", "shortJun", "shortJul", "shortAug", "shortSep", "shortOct", "shortNov", "shortDec"] as const;

export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = (index: number) => sharedT(locale)(`shared.months.${SHORT_MONTHS[index]!}`);
  if (iso.length === 10) return `${date.getUTCDate()} ${month(date.getUTCMonth())} ${date.getUTCFullYear()}`;
  return `${date.getDate()} ${month(date.getMonth())} ${date.getFullYear()}`;
}

export function relativeTime(iso: string, locale: Locale, now: number = Date.now()): string {
  const t = sharedT(locale);
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const elapsed = now - then;
  if (elapsed < 0) return t("shared.helpers.now");
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("shared.helpers.now");
  if (minutes < 60) return t("shared.helpers.minutesAgo", { minutes });
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return t("shared.helpers.hoursAgo", { hours });
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 30) return t("shared.helpers.daysAgo", { days });
  return formatDate(iso, locale);
}

export function activityDay(iso: string, locale: Locale, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const t = sharedT(locale);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / DAY_MS);
  if (days <= 0) return t("shared.helpers.today");
  if (days === 1) return t("shared.helpers.yesterday");
  if (days < 7) return date.toLocaleDateString(intlLocale(locale), { weekday: "long" });
  return date.toLocaleDateString(intlLocale(locale), { month: "long", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

export function suggestionReason(reader: Pick<SuggestedReader, "sharedCount">, locale: Locale): string {
  const t = sharedT(locale);
  if (reader.sharedCount === 0) return t("shared.helpers.recentlyActive");
  return t("shared.helpers.sharedBooks", { count: reader.sharedCount });
}

export function personCaption(person: PersonResult | SuggestedReader, locale: Locale): string {
  const t = sharedT(locale);
  if ("sharedCount" in person) return suggestionReason(person, locale);
  if (person.private) return t("shared.helpers.private");
  return t("shared.helpers.followers", { count: person.followerCount });
}

export function followFailureMessage(error: unknown, generic: string): string {
  if (!(error instanceof Error) || !("status" in error)) return generic;
  return error.status === 409 && error.message ? error.message : generic;
}
