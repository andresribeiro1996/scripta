import { randomUUID } from "node:crypto";
import { bookMatchKeys } from "@scripta/shared";
import type { IdentityKey, ReaderProfile } from "@scripta/shared";
import { categoryFor, contentDetail, decodeCursor, encodeCursor, DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import type { ActivityEventType, ActivityItem, CommunityAuthor, CommunityEventType, DiscoverItem, DiscoverType, FeedSettings, FollowState, GameParticipation, OwnProfile, Page, ParticipationGameKind, PersonResult, PublishProfileInput, PublishedContent, PublishedProfile, SuggestedReader, TierlistSummary, TournamentSummary } from "@scripta/shared/community";
import type { DashboardFeedPage, DigestItem, DigestKind, ParticipationItem } from "@scripta/shared/dashboard";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralsPublicApi } from "../murals/publicApi.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import { InvalidCursorError, MuralNotOwnedError, NotFollowingError, ProfileNotFoundError, SelfFollowError, UsernameRequiredError } from "./domain/errors.js";
import type { CommunityRepository, CursorKeyset } from "./domain/ports.js";
import type { EventRow, FollowRow } from "./domain/types.js";

const DISCOVER_SCAN_CAP = 500;
const SUGGESTION_SCAN_CAP = 500;
const SUGGESTION_OVERLAP_FLOOR = 5;
const SHARED_BOOKS_SHOWN = 3;
const DASHBOARD_COUNT_CAP = 100;
const DASHBOARD_REFILL_ROUNDS = 5;
const NAMED_PARTICIPANTS = 3;
const DIGEST_EVENT_TYPES: Array<[ActivityEventType, DigestKind]> = [
  ["tierlist_published", "publication"],
  ["tournament_published", "publication"],
  ["voted_on", "vote"],
  ["book_added", "reading"],
  ["book_finished", "reading"]
];
const LEGACY_DIGEST_KINDS: ReadonlySet<string> = new Set(["publication", "vote", "reading", "follow"]);

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

function libraryBooks(doc: Record<string, unknown> | null): Record<string, unknown>[] {
  return doc && Array.isArray(doc.books) ? doc.books.filter((book): book is Record<string, unknown> => typeof book === "object" && book !== null) : [];
}

export interface PublicProfileView {
  private: boolean;
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
  readerGlyphFor(userId: string): IdentityKey | null;
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
    listVotedByUser(voterUserId: string): PublishedTournamentRef[];
  };
  participation: {
    tierlists(userId: string): GameParticipation[];
    tournaments(userId: string): GameParticipation[];
    quizzes(userId: string): GameParticipation[];
  };
}

export interface CommunityService {
  follow(followerId: string, followeeId: string): void;
  unfollow(followerId: string, followeeId: string): void;
  getFollowState(viewerId: string, userId: string): FollowState;
  emitEvent(userId: string, type: ActivityEventType, refType: CommunityRefType, refId: string, payload?: Record<string, unknown>): void;
  publishProfile(userId: string, input: PublishProfileInput): void;
  unpublishProfile(userId: string): void;
  getOwnProfile(userId: string): OwnProfile;
  setShelfMural(userId: string, muralId: string): void;
  getProfileByUsername(username: string, viewerId?: string): PublicProfileView;
  getDashboard(viewerId: string, cursor: string | undefined, limit: number, kinds?: ReadonlySet<string>): DashboardFeedPage;
  markDashboardSeen(viewerId: string): void;
  getDiscover(type: DiscoverType, q: string, limit: number, offset: number, viewerId?: string): { items: DiscoverItem[]; nextOffset: number | null };
  searchPeople(viewerId: string, q: string, limit: number): PersonResult[];
  suggestPeople(viewerId: string, limit: number): SuggestedReader[];
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
  const glyphLookup = (): ((userId: string) => IdentityKey | null) => {
    const cache = new Map<string, IdentityKey | null>();
    return (userId) => {
      if (cache.has(userId)) return cache.get(userId) ?? null;
      const glyph = repo.getProfileRow(userId)?.published === 1 && settingsFor(userId).readerGlyph ? deps.readerGlyphFor(userId) : null;
      cache.set(userId, glyph);
      return glyph;
    };
  };
  const withGlyph = (author: ReaderProfile & { unavailable?: boolean }, userId: string, glyphOf: (userId: string) => IdentityKey | null): CommunityAuthor => {
    if (author.unavailable) return { ...author, userId };
    const glyph = glyphOf(userId);
    return glyph ? { ...author, userId, readerGlyph: glyph } : { ...author, userId };
  };
  const visibleUserId = (username: string, viewerId: string | undefined): string => {
    const userId = deps.findUserIdByUsername(username);
    if (!userId) throw new ProfileNotFoundError();
    if (userId === viewerId) return userId;
    const row = repo.getProfileRow(userId);
    if (!row || row.published !== 1) throw new ProfileNotFoundError();
    return userId;
  };
  const publishedUserId = (username: string): string => visibleUserId(username, undefined);

  type DigestRow = { id: string; createdAt: string; event?: EventRow; follow?: FollowRow; participation?: ParticipationItem };
  type Bound = { keyset?: CursorKeyset; since?: string };

  const digestTypesFor = (userId: string, kinds: ReadonlySet<string>): ActivityEventType[] => {
    const settings = settingsFor(userId);
    return DIGEST_EVENT_TYPES.filter(([type, kind]) => kinds.has(kind) && settings[categoryFor(type)]).map(([type]) => type);
  };
  const withinBound = (bound: Bound, createdAt: string, id: string): boolean =>
    bound.since !== undefined ? createdAt > bound.since : !bound.keyset || createdAt < bound.keyset.createdAt || (createdAt === bound.keyset.createdAt && id < bound.keyset.id);
  const newestFirst = (a: DigestRow, b: DigestRow): number => (a.createdAt !== b.createdAt ? b.createdAt.localeCompare(a.createdAt) : a.id < b.id ? 1 : -1);

  const participationItems = (viewerId: string): ParticipationItem[] => {
    const glyphOf = glyphLookup();
    const games: Array<[ParticipationGameKind, GameParticipation[]]> = [
      ["tierlist", deps.participation.tierlists(viewerId)],
      ["tournament", deps.participation.tournaments(viewerId)],
      ["quiz", deps.participation.quizzes(viewerId)]
    ];
    return games.flatMap(([kind, list]) =>
      list.map((game) => {
        const nameable = game.recent.map((entry) => entry.userId).filter((userId) => repo.getProfileRow(userId)?.published === 1 && settingsFor(userId).votes);
        const profiles = deps.resolveProfiles(nameable);
        const actors = nameable
          .filter((userId) => profiles.has(userId))
          .slice(0, NAMED_PARTICIPANTS)
          .map((userId) => withGlyph(profiles.get(userId)!, userId, glyphOf));
        return { kind: "participation" as const, id: `${kind}:${game.id}`, game: { kind, id: game.id, name: game.name, covers: game.covers.slice(0, FEED_COVER_LIMIT) }, actors, count: game.participantCount, createdAt: game.latestAt };
      })
    );
  };

  const followingWindows = (followees: string[], bound: Bound, limit: number, kinds: ReadonlySet<string>): DigestRow[][] =>
    followees.map((followeeId) => {
      const types = digestTypesFor(followeeId, kinds);
      if (types.length === 0) return [];
      const events = bound.since !== undefined ? repo.listEventsByUserSince(followeeId, bound.since, limit, types) : repo.listEventsByUser(followeeId, bound.keyset, limit, types);
      return events.map((event) => ({ id: event.id, createdAt: event.created_at, event }));
    });

  const followerRows = (viewerId: string, bound: Bound, limit: number): DigestRow[] =>
    (bound.since !== undefined ? repo.listFollowersSince(viewerId, bound.since, limit) : repo.listFollowersByFollowee(viewerId, bound.keyset, limit)).map((follow) => ({ id: follow.follower_id, createdAt: follow.created_at, follow }));

  const participationRows = (participation: ParticipationItem[], bound: Bound): DigestRow[] =>
    participation.filter((item) => withinBound(bound, item.createdAt, item.id)).map((item) => ({ id: item.id, createdAt: item.createdAt, participation: item }));

  const toDigestItem = (row: DigestRow, profiles: Map<string, ReaderProfile>, glyphOf: (userId: string) => IdentityKey | null, followees: string[]): DigestItem | undefined => {
    if (row.event) {
      const event = row.event;
      const actor = profiles.get(event.user_id);
      if (event.type === "tierlist_published" || event.type === "tournament_published") {
        if (event.ref_type === "tierlist") {
          const ref = deps.tierlists.get(event.ref_id);
          // A promoted tier list outlives its creator's profile, so it keeps
          // a placeholder author rather than dropping out of the feed.
          const author = ref && ref.ownerUserId === event.user_id ? actor ?? (ref.promotedAt ? { username: "Original creator unavailable", avatarUrl: null, unavailable: true } : undefined) : undefined;
          if (ref && author) return { kind: "publication", id: event.id, actor: withGlyph(author, event.user_id, glyphOf), type: event.type as CommunityEventType, content: toTierlistSummary(ref), createdAt: event.created_at };
        } else {
          const ref = deps.tournaments.get(event.ref_id);
          if (ref && ref.ownerUserId === event.user_id && actor) return { kind: "publication", id: event.id, actor: withGlyph(actor, event.user_id, glyphOf), type: event.type as CommunityEventType, content: toTournamentSummary(ref), createdAt: event.created_at };
        }
      } else if (event.type === "voted_on") {
        // The voter is not the owner here, so there is no ownership check to
        // make — only that the thing voted on is still published.
        const content = event.ref_type === "tierlist"
          ? (() => { const ref = deps.tierlists.get(event.ref_id); return ref ? toTierlistSummary(ref) : undefined; })()
          : (() => { const ref = deps.tournaments.get(event.ref_id); return ref ? toTournamentSummary(ref) : undefined; })();
        if (content && actor) return { kind: "vote", id: event.id, actor: withGlyph(actor, event.user_id, glyphOf), content, createdAt: event.created_at };
      } else if (event.type === "book_added" || event.type === "book_finished") {
        const payload = parseEventPayload(event.payload);
        if (payload && actor) {
          const coverUrl = typeof payload.coverUrl === "string" ? payload.coverUrl : null;
          return {
            kind: "reading",
            id: event.id,
            actor: withGlyph(actor, event.user_id, glyphOf),
            book: { title: String(payload.title ?? ""), author: String(payload.author ?? ""), coverUrl },
            finished: event.type === "book_finished",
            createdAt: event.created_at
          };
        }
      }
    } else if (row.follow) {
      const author = profiles.get(row.follow.follower_id);
      if (author) {
        // followees is already loaded for the event half of this feed, so
        // knowing whether this is mutual costs nothing extra.
        return { kind: "follow", id: row.follow.follower_id, actor: withGlyph(author, row.follow.follower_id, glyphOf), createdAt: row.follow.created_at, viewerFollows: followees.includes(row.follow.follower_id) };
      }
    }
    return undefined;
  };

  const buildItems = (rows: DigestRow[], followees: string[], limit: number, glyphOf: (userId: string) => IdentityKey | null, horizon?: CursorKeyset): { items: DigestItem[]; last?: DigestRow; more: boolean } => {
    rows.sort(newestFirst);
    const actorIds = new Set<string>();
    for (const row of rows) {
      if (row.event) actorIds.add(row.event.user_id);
      if (row.follow) actorIds.add(row.follow.follower_id);
    }
    const profiles = deps.resolveProfiles([...actorIds]);
    const items: DigestItem[] = [];
    let last: DigestRow | undefined;
    for (const row of rows) {
      if (items.length === limit || (horizon && withinBound({ keyset: horizon }, row.createdAt, row.id))) return { items, last, more: true };
      const item = row.participation ?? toDigestItem(row, profiles, glyphOf, followees);
      if (item) items.push(item);
      last = row;
    }
    return { items, last, more: false };
  };
  const countItems = (rows: DigestRow[], followees: string[]): number => buildItems(rows, followees, DASHBOARD_COUNT_CAP, () => null).items.length;

  return {
    follow(followerId, followeeId) {
      if (followerId === followeeId) throw new SelfFollowError();
      if (!deps.resolveProfiles([followeeId]).has(followeeId)) throw new ProfileNotFoundError();
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
    publishProfile(userId, input) {
      if (!deps.userHasUsername(userId)) throw new UsernameRequiredError();
      if (input.muralId !== undefined && !deps.murals.ownsMural(userId, input.muralId)) throw new MuralNotOwnedError();
      const existing = repo.getProfileRow(userId);
      const keptMural = existing?.mural_id && deps.murals.ownsMural(userId, existing.mural_id) ? existing.mural_id : null;
      const muralId = input.muralId ?? keptMural;
      const now = new Date().toISOString();
      repo.upsertProfile({
        user_id: userId,
        published: 1,
        mural_id: muralId,
        published_at: existing?.published_at ?? now,
        updated_at: now,
        feed_settings: existing?.feed_settings ?? null
      });
      if (input.shareReading !== undefined) repo.updateFeedSettings(userId, { ...settingsFor(userId), reading: input.shareReading });
      if (muralId && (!existing?.published_at || existing.mural_id !== muralId)) emit(userId, "mural_published", "mural", muralId);
    },
    unpublishProfile(userId) {
      const existing = repo.getProfileRow(userId);
      if (!existing) return;
      repo.upsertProfile({ ...existing, published: 0, updated_at: new Date().toISOString() });
    },
    getOwnProfile(userId) {
      const row = repo.getProfileRow(userId);
      const muralId = row?.mural_id && deps.murals.ownsMural(userId, row.mural_id) ? row.mural_id : null;
      return { muralId, published: row?.published === 1, feedSettings: settingsFor(userId) };
    },
    setShelfMural(userId, muralId) {
      if (!deps.murals.ownsMural(userId, muralId)) throw new MuralNotOwnedError();
      const existing = repo.getProfileRow(userId);
      repo.upsertProfile({
        user_id: userId,
        published: existing?.published ?? 0,
        mural_id: muralId,
        published_at: existing?.published_at ?? null,
        updated_at: new Date().toISOString(),
        feed_settings: existing?.feed_settings ?? null
      });
      if (existing?.published === 1 && existing.mural_id !== muralId) emit(userId, "mural_published", "mural", muralId);
    },
    getProfileByUsername(username, viewerId) {
      const userId = deps.findUserIdByUsername(username);
      if (!userId) throw new ProfileNotFoundError();
      const row = repo.getProfileRow(userId);
      const published = row?.published === 1;
      if (!published && viewerId === userId) throw new ProfileNotFoundError();
      const author = deps.resolveProfiles([userId]).get(userId);
      if (!author) throw new ProfileNotFoundError();
      const mural = published && row.mural_id ? deps.murals.getMuralPublicPayload(userId, row.mural_id) : null;
      const glyphOf = glyphLookup();
      const view: PublicProfileView = {
        private: !published,
        profile: {
          user: withGlyph(author, userId, glyphOf),
          publishedAt: published ? row.published_at ?? row.updated_at : null,
          followerCount: repo.countFollowers(userId),
          followingCount: repo.countFollowing(userId),
          viewerFollows: viewerId ? repo.getFollow(viewerId, userId) !== undefined : undefined
        },
        mural,
        published: {
          tierlists: published ? deps.tierlists.listByOwner(userId).map(toTierlistSummary) : [],
          tournaments: published ? deps.tournaments.listByOwner(userId).map(toTournamentSummary) : []
        }
      };
      if (viewerId === userId) view.feedSettings = settingsFor(userId);
      return view;
    },
    getDashboard(viewerId, cursor, limit, kinds = LEGACY_DIGEST_KINDS) {
      const keyset = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !keyset) throw new InvalidCursorError();
      const followees = repo.listFollowees(viewerId);
      const participation = kinds.has("participation") ? participationItems(viewerId) : [];
      const followers = (bound: Bound, count: number): DigestRow[] => (kinds.has("follow") ? followerRows(viewerId, bound, count) : []);
      const glyphOf = glyphLookup();
      const items: DigestItem[] = [];
      let pageBound: Bound = { keyset };
      let last: DigestRow | undefined;
      let more = true;
      for (let round = 0; more && items.length < limit && round < DASHBOARD_REFILL_ROUNDS; round++) {
        const windows = [...followingWindows(followees, pageBound, limit + 1, kinds), followers(pageBound, limit + 1)];
        const horizon = windows.filter((rows) => rows.length === limit + 1).map((rows) => rows[rows.length - 1]!).sort(newestFirst)[0];
        const page = buildItems([...windows.flat(), ...participationRows(participation, pageBound)], followees, limit - items.length, glyphOf, horizon);
        items.push(...page.items);
        last = page.last ?? last;
        more = page.more || horizon !== undefined;
        if (last) pageBound = { keyset: last };
      }
      const nextCursor = more && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      if (keyset) return { items, nextCursor, seenAt: null, personalNewCount: 0, followingNewCount: 0 };
      const seenAt = deps.getDashboardSeenAt(viewerId);
      const countBound: Bound = seenAt ? { since: seenAt } : {};
      const personalNewCount = countItems([...followers(countBound, DASHBOARD_COUNT_CAP), ...participationRows(participation, countBound)], followees);
      const followingNewCount = countItems(followingWindows(followees, countBound, DASHBOARD_COUNT_CAP, kinds).flat(), followees);
      return { items, nextCursor, seenAt, personalNewCount, followingNewCount };
    },
    markDashboardSeen(viewerId) {
      deps.setDashboardSeenAt(viewerId, new Date().toISOString());
    },
    getDiscover(type, q, limit, offset, viewerId) {
      const needle = q.trim().toLowerCase();
      const window = needle ? DISCOVER_SCAN_CAP : Math.min(offset + limit + 1, DISCOVER_SCAN_CAP);
      const entries: Array<{ userId: string; content: PublishedContent; createdAt: string }> = [];
      if (type !== "tournament") {
        const voted = viewerId ? new Set(deps.tierlists.listVotedByUser(viewerId).map((ref) => ref.id)) : null;
        for (const ref of deps.tierlists.list(window, 0)) {
          const content = voted ? { ...toTierlistSummary(ref), viewerVoted: voted.has(ref.id) } : toTierlistSummary(ref);
          entries.push({ userId: ref.ownerUserId, content, createdAt: ref.createdAt });
        }
      }
      if (type !== "tierlist") {
        const voted = viewerId ? new Set(deps.tournaments.listVotedByUser(viewerId).map((ref) => ref.id)) : null;
        for (const ref of deps.tournaments.list(window, 0)) {
          const content = voted ? { ...toTournamentSummary(ref), viewerVoted: voted.has(ref.id) } : toTournamentSummary(ref);
          entries.push({ userId: ref.ownerUserId, content, createdAt: ref.createdAt });
        }
      }
      const authors = deps.resolveProfiles([...new Set(entries.map((e) => e.userId))]);
      const glyphOf = glyphLookup();
      const visible = entries
        .flatMap((entry) => {
          const author = authors.get(entry.userId) ?? (entry.content.kind === "tierlist" && entry.content.promotedAt ? { username: "Original creator unavailable", avatarUrl: null, unavailable: true } : undefined);
          if (!author) return [];
          if (needle && !entry.content.name.toLowerCase().includes(needle)) return [];
          return [{ userId: entry.userId, author, content: entry.content, createdAt: entry.createdAt }];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        items: visible.slice(offset, offset + limit).map(({ userId, author, content }) => ({ author: withGlyph(author, userId, glyphOf), content })),
        nextOffset: offset + limit < visible.length ? offset + limit : null
      };
    },
    searchPeople(viewerId, q, limit) {
      const needle = q.trim();
      if (!needle) return [];
      const found = deps.searchUsernameOwners(needle, limit).filter((id) => id !== viewerId);
      const authors = deps.resolveProfiles(found);
      const glyphOf = glyphLookup();
      return found.flatMap((id) => {
        const user = authors.get(id);
        if (!user) return [];
        return [{ user: withGlyph(user, id, glyphOf), followerCount: repo.countFollowers(id), viewerFollows: repo.getFollow(viewerId, id) !== undefined, private: repo.getProfileRow(id)?.published !== 1 }];
      });
    },
    suggestPeople(viewerId, limit) {
      const own = new Set<string>();
      for (const book of libraryBooks(deps.resolveLibrary(viewerId))) for (const key of bookMatchKeys(book)) own.add(key);
      const followees = new Set(repo.listFollowees(viewerId));
      const candidates = repo
        .listPublishedProfiles(SUGGESTION_SCAN_CAP)
        .map((row) => row.user_id)
        .filter((id) => id !== viewerId && !followees.has(id));
      const profiles = deps.resolveProfiles(candidates);
      const scored = candidates.flatMap((id, recency) => {
        const user = profiles.get(id);
        if (!user) return [];
        const shared = libraryBooks(deps.resolveLibrary(id)).filter((book) => bookMatchKeys(book).some((key) => own.has(key)));
        return [{ id, user, recency, shared }];
      });
      const overlapping = scored.filter((entry) => entry.shared.length > 0).sort((a, b) => b.shared.length - a.shared.length || a.recency - b.recency);
      const fill = overlapping.length < SUGGESTION_OVERLAP_FLOOR ? scored.filter((entry) => entry.shared.length === 0) : [];
      const glyphOf = glyphLookup();
      return [...overlapping, ...fill].slice(0, limit).map((entry) => ({
        user: withGlyph(entry.user, entry.id, glyphOf),
        followerCount: repo.countFollowers(entry.id),
        viewerFollows: false,
        private: false,
        sharedCount: entry.shared.length,
        sharedBooks: entry.shared.slice(0, SHARED_BOOKS_SHOWN).map((book) => ({ title: String(book.Title ?? ""), author: String(book.Attribution ?? ""), coverUrl: typeof book._coverUrl === "string" ? book._coverUrl : null }))
      }));
    },
    getLibrary(username) {
      return { data: deps.resolveLibrary(publishedUserId(username)) };
    },
    getActivity(username, viewerId, cursor, limit) {
      const userId = visibleUserId(username, viewerId);
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
