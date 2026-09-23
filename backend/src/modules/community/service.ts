import { randomUUID } from "node:crypto";
import type { ReaderProfile } from "@scripta/shared";
import { categoryFor, contentDetail, decodeCursor, encodeCursor, DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import type { ActivityEventType, ActivityItem, CommunityEventType, DiscoverItem, DiscoverType, FeedCategory, FeedSettings, FollowState, Page, PersonResult, PublishedContent, PublishedProfile, TierlistSummary, TournamentSummary } from "@scripta/shared/community";
import type { DashboardFeedPage, DigestItem } from "@scripta/shared/dashboard";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralsPublicApi } from "../murals/publicApi.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import { InvalidCursorError, MuralNotOwnedError, NotFollowingError, ProfileNotFoundError, SelfFollowError, UsernameRequiredError } from "./domain/errors.js";
import type { CommunityRepository, CursorKeyset } from "./domain/ports.js";
import type { EventRow, FollowRow } from "./domain/types.js";

const DISCOVER_SCAN_CAP = 500;

export type CommunityRefType = "tierlist" | "tournament" | "book" | "user" | "mural";

function parseEventPayload(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export interface PublicProfileView {
  profile: PublishedProfile;
  mural: MuralPublicPayload | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
  feedSettings?: FeedSettings;
}

/** What a feed row can show at a glance — the rest of a pool's covers are
 *  a page the reader taps through to, not a thumbnail. */
const FEED_COVER_LIMIT = 3;

function toTierlistSummary(ref: PublishedTierlistRef): TierlistSummary {
  return { kind: "tierlist", id: ref.id, voteCode: ref.voteCode, name: ref.name, poolSize: ref.poolSize, ballotCount: ref.ballotCount, votingOpen: ref.votingOpen, promotedAt: ref.promotedAt, covers: ref.covers.slice(0, FEED_COVER_LIMIT) };
}

function toTournamentSummary(ref: PublishedTournamentRef): TournamentSummary {
  return { kind: "tournament", id: ref.id, name: ref.name, bracketSize: ref.bracketSize, status: ref.status, bookCount: ref.bracketSize, covers: ref.covers.slice(0, FEED_COVER_LIMIT) };
}

export interface CommunityDeps {
  repo: CommunityRepository;
  getDashboardSeenAt(userId: string): string | null;
  setDashboardSeenAt(userId: string, seenAt: string): void;
  resolveProfile(userId: string): ReaderProfile | undefined;
  resolveProfiles(userIds: string[]): Map<string, ReaderProfile>;
  resolveLibrary(userId: string): Record<string, unknown> | null;
  userHasUsername(userId: string): boolean;
  findUserIdByUsername(username: string): string | undefined;
  searchUsernameOwners(query: string, limit: number): string[];
  murals: Pick<MuralsPublicApi, "ownsMural" | "getMuralPublicPayload">;
  tierlists: {
    list(limit: number, offset: number): PublishedTierlistRef[];
    get(id: string): PublishedTierlistRef | undefined;
    listByOwner(ownerUserId: string): PublishedTierlistRef[];
    listVotedByUser(voterUserId: string): PublishedTierlistRef[];
  };
  tournaments: {
    list(limit: number, offset: number): PublishedTournamentRef[];
    get(id: string): PublishedTournamentRef | undefined;
    listByOwner(ownerUserId: string): PublishedTournamentRef[];
  };
}

export interface CommunityService {
  follow(followerId: string, followeeId: string): void;
  unfollow(followerId: string, followeeId: string): void;
  getFollowState(viewerId: string, userId: string): FollowState;
  emitEvent(userId: string, type: ActivityEventType, refType: CommunityRefType, refId: string, payload?: Record<string, unknown>): void;
  publishProfile(userId: string, muralId: string): void;
  unpublishProfile(userId: string): void;
  getProfileByUsername(username: string, viewerId?: string): PublicProfileView;
  getDashboard(viewerId: string, cursor: string | undefined, limit: number): DashboardFeedPage;
  markDashboardSeen(viewerId: string): void;
  getDiscover(type: DiscoverType, q: string, limit: number, offset: number, viewerId?: string): { items: DiscoverItem[]; nextOffset: number | null };
  searchPeople(viewerId: string, q: string, limit: number): PersonResult[];
  getActivity(username: string, viewerId: string | undefined, cursor: string | undefined, limit: number): Page<ActivityItem>;
  getLibrary(username: string): { data: Record<string, unknown> | null };
  getFeedSettings(userId: string): FeedSettings;
  updateFeedSettings(userId: string, settings: FeedSettings): void;
}

export function createCommunityService(deps: CommunityDeps): CommunityService {
  const { repo } = deps;
  const emit = (userId: string, type: ActivityEventType, refType: CommunityRefType, refId: string, payload?: Record<string, unknown>): void => {
    repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, payload: payload ? JSON.stringify(payload) : null, created_at: new Date().toISOString() });
  };
  const settingsFor = (userId: string): FeedSettings => repo.getFeedSettings(userId) ?? DEFAULT_FEED_SETTINGS;
  const publishedUserId = (username: string): string => {
    const userId = deps.findUserIdByUsername(username);
    if (!userId) throw new ProfileNotFoundError();
    const row = repo.getProfileRow(userId);
    if (!row || row.published !== 1) throw new ProfileNotFoundError();
    return userId;
  };
  return {
    follow(followerId, followeeId) {
      if (followerId === followeeId) throw new SelfFollowError();
      const row = repo.getProfileRow(followeeId);
      if (!row || row.published !== 1) throw new ProfileNotFoundError();
      const inserted = repo.insertFollow({ follower_id: followerId, followee_id: followeeId, created_at: new Date().toISOString() });
      if (inserted) {
        const author = deps.resolveProfiles([followeeId]).get(followeeId);
        emit(followerId, "following", "user", followeeId, { username: author?.username ?? "" });
      }
    },
    unfollow(followerId, followeeId) {
      if (!repo.deleteFollow(followerId, followeeId)) throw new NotFollowingError();
    },
    getFollowState(viewerId, userId) {
      return {
        following: repo.getFollow(viewerId, userId) !== undefined,
        followerCount: repo.countFollowers(userId),
        followingCount: repo.countFollowing(userId)
      };
    },
    emitEvent: emit,
    publishProfile(userId, muralId) {
      if (!deps.userHasUsername(userId)) throw new UsernameRequiredError();
      if (!deps.murals.ownsMural(userId, muralId)) throw new MuralNotOwnedError();
      const existing = repo.getProfileRow(userId);
      const previousMuralId = existing?.mural_id ?? null;
      const now = new Date().toISOString();
      repo.upsertProfile({
        user_id: userId,
        published: 1,
        mural_id: muralId,
        published_at: existing?.published_at ?? now,
        updated_at: now,
        feed_settings: existing?.feed_settings ?? null
      });
      if (previousMuralId !== muralId) emit(userId, "mural_published", "mural", muralId);
    },
    unpublishProfile(userId) {
      const existing = repo.getProfileRow(userId);
      if (!existing) return;
      repo.upsertProfile({ ...existing, published: 0, updated_at: new Date().toISOString() });
    },
    getProfileByUsername(username, viewerId) {
      const userId = deps.findUserIdByUsername(username);
      if (!userId) throw new ProfileNotFoundError();
      const row = repo.getProfileRow(userId);
      if (!row || row.published !== 1) throw new ProfileNotFoundError();
      const author = deps.resolveProfiles([userId]).get(userId);
      if (!author) throw new ProfileNotFoundError();
      const mural = row.mural_id ? deps.murals.getMuralPublicPayload(userId, row.mural_id) : null;
      const view: PublicProfileView = {
        profile: {
          user: { ...author, userId },
          publishedAt: row.published_at ?? row.updated_at,
          followerCount: repo.countFollowers(userId),
          followingCount: repo.countFollowing(userId),
          viewerFollows: viewerId ? repo.getFollow(viewerId, userId) !== undefined : undefined
        },
        mural,
        published: {
          tierlists: deps.tierlists.listByOwner(userId).map(toTierlistSummary),
          tournaments: deps.tournaments.listByOwner(userId).map(toTournamentSummary)
        }
      };
      if (viewerId === userId) view.feedSettings = settingsFor(userId);
      return view;
    },
    getDashboard(viewerId, cursor, limit) {
      const keyset = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !keyset) throw new InvalidCursorError();
      type Row = { id: string; createdAt: string; event?: EventRow; follow?: FollowRow };
      const rows: Row[] = [];
      const followees = repo.listFollowees(viewerId);
      for (const followeeId of followees) {
        rows.push(...repo.listEventsByUser(followeeId, keyset, limit + 1).map((event) => ({ id: event.id, createdAt: event.created_at, event })));
      }
      rows.push(...repo.listFollowersByFollowee(viewerId, keyset, limit + 1).map((follow) => ({ id: follow.follower_id, createdAt: follow.created_at, follow })));
      rows.sort((a, b) => (a.createdAt !== b.createdAt ? b.createdAt.localeCompare(a.createdAt) : a.id < b.id ? 1 : -1));
      const actorIds = new Set<string>();
      for (const row of rows) {
        if (row.event) actorIds.add(row.event.user_id);
        if (row.follow) actorIds.add(row.follow.follower_id);
      }
      const profiles = deps.resolveProfiles([...actorIds]);
      // The publisher's own switches, the same ones their profile's activity
      // list obeys — a category they broadcast there, they broadcast here.
      const settingsCache = new Map<string, FeedSettings>();
      const broadcasts = (actorId: string, category: FeedCategory): boolean => {
        let settings = settingsCache.get(actorId);
        if (!settings) {
          settings = settingsFor(actorId);
          settingsCache.set(actorId, settings);
        }
        return settings[category];
      };
      const items: DigestItem[] = [];
      let nextCursor: string | null = null;
      let lastIncluded: Row | undefined;
      for (const row of rows) {
        if (items.length === limit) {
          if (lastIncluded) nextCursor = encodeCursor({ createdAt: lastIncluded.createdAt, id: lastIncluded.id });
          break;
        }
        if (row.event) {
          const event = row.event;
          const category = categoryFor(event.type as ActivityEventType);
          if (!broadcasts(event.user_id, category)) continue;
          const actor = profiles.get(event.user_id);
          if (event.type === "tierlist_published" || event.type === "tournament_published") {
            if (event.ref_type === "tierlist") {
              const ref = deps.tierlists.get(event.ref_id);
              // A promoted tier list outlives its creator's profile, so it keeps
              // a placeholder author rather than dropping out of the feed.
              const author = ref && ref.ownerUserId === event.user_id ? actor ?? (ref.promotedAt ? { username: "Original creator unavailable", avatarUrl: null, unavailable: true } : undefined) : undefined;
              if (ref && author) {
                items.push({ kind: "publication", id: event.id, actor: { ...author, userId: event.user_id }, type: event.type as CommunityEventType, content: toTierlistSummary(ref), createdAt: event.created_at });
                lastIncluded = row;
              }
            } else {
              const ref = deps.tournaments.get(event.ref_id);
              if (ref && ref.ownerUserId === event.user_id && actor) {
                items.push({ kind: "publication", id: event.id, actor: { ...actor, userId: event.user_id }, type: event.type as CommunityEventType, content: toTournamentSummary(ref), createdAt: event.created_at });
                lastIncluded = row;
              }
            }
          } else if (event.type === "voted_on") {
            // The voter is not the owner here, so there is no ownership check to
            // make — only that the thing voted on is still published.
            const content = event.ref_type === "tierlist"
              ? (() => { const ref = deps.tierlists.get(event.ref_id); return ref ? toTierlistSummary(ref) : undefined; })()
              : (() => { const ref = deps.tournaments.get(event.ref_id); return ref ? toTournamentSummary(ref) : undefined; })();
            if (content && actor) {
              items.push({ kind: "vote", id: event.id, actor: { ...actor, userId: event.user_id }, content, createdAt: event.created_at });
              lastIncluded = row;
            }
          } else if (event.type === "book_added" || event.type === "book_finished") {
            const payload = parseEventPayload(event.payload);
            if (payload && actor) {
              const coverUrl = typeof payload.coverUrl === "string" ? payload.coverUrl : null;
              items.push({
                kind: "reading",
                id: event.id,
                actor: { ...actor, userId: event.user_id },
                book: { title: String(payload.title ?? ""), author: String(payload.author ?? ""), coverUrl },
                finished: event.type === "book_finished",
                createdAt: event.created_at
              });
              lastIncluded = row;
            }
          }
        } else if (row.follow) {
          const author = profiles.get(row.follow.follower_id);
          if (author) {
            // followees is already loaded for the event half of this feed, so
            // knowing whether this is mutual costs nothing extra.
            items.push({ kind: "follow", id: row.follow.follower_id, actor: { ...author, userId: row.follow.follower_id }, createdAt: row.follow.created_at, viewerFollows: followees.includes(row.follow.follower_id) });
            lastIncluded = row;
          }
        }
      }
      const seen = keyset ? null : deps.getDashboardSeenAt(viewerId);
      const newCount = !keyset && seen ? repo.countEventsByUsersSince(followees, seen) + repo.countFollowersSince(viewerId, seen) : 0;
      return { items, nextCursor, newCount };
    },
    markDashboardSeen(viewerId) {
      deps.setDashboardSeenAt(viewerId, new Date().toISOString());
    },
    getDiscover(type, q, limit, offset, viewerId) {
      const needle = q.trim().toLowerCase();
      const window = Math.min(offset + limit, DISCOVER_SCAN_CAP);
      const entries: Array<{ userId: string; content: PublishedContent; createdAt: string }> = [];
      if (type !== "tournament") {
        const voted = viewerId ? new Set(deps.tierlists.listVotedByUser(viewerId).map((ref) => ref.id)) : null;
        for (const ref of deps.tierlists.list(window, 0)) {
          const content = voted ? { ...toTierlistSummary(ref), viewerVoted: voted.has(ref.id) } : toTierlistSummary(ref);
          entries.push({ userId: ref.ownerUserId, content, createdAt: ref.createdAt });
        }
      }
      if (type !== "tierlist") {
        for (const ref of deps.tournaments.list(window, 0)) entries.push({ userId: ref.ownerUserId, content: toTournamentSummary(ref), createdAt: ref.createdAt });
      }
      const authors = deps.resolveProfiles([...new Set(entries.map((e) => e.userId))]);
      const visible = entries
        .flatMap((entry) => {
          const author = authors.get(entry.userId) ?? (entry.content.kind === "tierlist" && entry.content.promotedAt ? { username: "Original creator unavailable", avatarUrl: null, unavailable: true } : undefined);
          if (!author) return [];
          if (needle && !entry.content.name.toLowerCase().includes(needle)) return [];
          return [{ userId: entry.userId, author, content: entry.content, createdAt: entry.createdAt }];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        items: visible.slice(offset, offset + limit).map(({ userId, author, content }) => ({ author: { ...author, userId }, content })),
        nextOffset: offset + limit < visible.length ? offset + limit : null
      };
    },
    searchPeople(viewerId, q, limit) {
      const needle = q.trim();
      if (!needle) return [];
      const candidates = deps.searchUsernameOwners(needle, limit * 2).filter((id) => id !== viewerId);
      const visible = candidates.filter((id) => repo.getProfileRow(id)?.published === 1).slice(0, limit);
      const authors = deps.resolveProfiles(visible);
      return visible.flatMap((id) => {
        const user = authors.get(id);
        if (!user) return [];
        return [{ user: { ...user, userId: id }, followerCount: repo.countFollowers(id), viewerFollows: repo.getFollow(viewerId, id) !== undefined }];
      });
    },
    getLibrary(username) {
      return { data: deps.resolveLibrary(publishedUserId(username)) };
    },
    getActivity(username, viewerId, cursor, limit) {
      const userId = publishedUserId(username);
      const keyset = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !keyset) throw new InvalidCursorError();
      const owner = viewerId === userId;
      const settings = settingsFor(userId);
      const toActivityItem = (event: EventRow): ActivityItem | undefined => {
        if (!owner && !settings[categoryFor(event.type)]) return undefined;
        if (event.type === "tierlist_published") {
          const ref = deps.tierlists.get(event.ref_id);
          if (!ref || ref.ownerUserId !== event.user_id) return undefined;
          const summary = toTierlistSummary(ref);
          const payload: Record<string, unknown> = { ...parseEventPayload(event.payload), name: ref.name, detail: contentDetail(summary), covers: summary.covers };
          if (ref.voteCode) payload.href = `/vote/${ref.voteCode}`;
          return { id: event.id, type: event.type, payload, createdAt: event.created_at };
        }
        if (event.type === "tournament_published") {
          const ref = deps.tournaments.get(event.ref_id);
          if (!ref || ref.ownerUserId !== event.user_id) return undefined;
          const summary = toTournamentSummary(ref);
          return { id: event.id, type: event.type, payload: { ...parseEventPayload(event.payload), name: ref.name, href: `/arena/${ref.id}`, detail: contentDetail(summary), covers: summary.covers }, createdAt: event.created_at };
        }
        const payload = parseEventPayload(event.payload);
        if (payload !== undefined && event.type === "voted_on") {
          if (payload.game === "tierlist") {
            const ref = deps.tierlists.get(event.ref_id);
            if (ref) Object.assign(payload, { covers: ref.covers.slice(0, FEED_COVER_LIMIT), ...(ref.voteCode ? { href: `/vote/${ref.voteCode}` } : {}) });
          } else {
            const ref = deps.tournaments.get(event.ref_id);
            if (ref) Object.assign(payload, { covers: ref.covers.slice(0, FEED_COVER_LIMIT), href: `/arena/${ref.id}` });
          }
        }
        return payload === undefined ? undefined : { id: event.id, type: event.type, payload, createdAt: event.created_at };
      };
      const items: ActivityItem[] = [];
      let nextCursor: string | null = null;
      let lastIncluded: EventRow | undefined;
      let fetchAfter: CursorKeyset | undefined = keyset;
      for (;;) {
        const batch = repo.listEventsByUser(userId, fetchAfter, limit + 1);
        if (batch.length === 0) break;
        let exhausted = false;
        for (const event of batch) {
          const item = toActivityItem(event);
          if (!item) continue;
          if (items.length === limit) {
            if (lastIncluded) nextCursor = encodeCursor({ createdAt: lastIncluded.created_at, id: lastIncluded.id });
            exhausted = true;
            break;
          }
          items.push(item);
          lastIncluded = event;
        }
        if (exhausted || batch.length <= limit) break;
        const last = batch[batch.length - 1]!;
        fetchAfter = { createdAt: last.created_at, id: last.id };
      }
      return { items, nextCursor };
    },
    getFeedSettings(userId) {
      return settingsFor(userId);
    },
    updateFeedSettings(userId, settings) {
      repo.updateFeedSettings(userId, settings);
    }
  };
}

export interface CommunityPublicApi {
  emitEvent(userId: string, type: ActivityEventType, refType: CommunityRefType, refId: string, payload?: Record<string, unknown>): void;
}

export function createCommunityPublicApi(repo: CommunityRepository): CommunityPublicApi {
  return {
    emitEvent(userId, type, refType, refId, payload) {
      repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, payload: payload ? JSON.stringify(payload) : null, created_at: new Date().toISOString() });
    }
  };
}
