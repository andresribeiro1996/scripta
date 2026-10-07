import { DEFAULT_FEED_SETTINGS, type FeedSettings } from "@scripta/shared/community";
import type { CommunityRepository, VisibilityRow } from "./ports.js";

export interface Standing {
  published: boolean;
  isViewer: boolean;
  followedByViewer: boolean;
  settings: FeedSettings;
}

export interface ReaderListing {
  followed: boolean;
  published: boolean;
  showGlyph: boolean;
}

export const canViewContent = (s: Standing): boolean => s.published || s.isViewer;
export const isPrivate = (s: Standing): boolean => !canViewContent(s);
export const showsGlyph = (s: Standing): boolean => s.published && s.settings.readerGlyph === true;
export const canNameAsParticipant = (s: Standing): boolean => s.published && s.settings.votes;
export const canFollow = (s: Standing, followsViewer: boolean): boolean => s.published || followsViewer;

export function readerListing(s: Standing): ReaderListing | undefined {
  const followed = s.followedByViewer && (s.published || s.settings.reading);
  if (!s.published && !followed) return undefined;
  return { followed, published: s.published, showGlyph: showsGlyph(s) };
}

const settingsOf = (row: VisibilityRow): FeedSettings => ({
  publications: row.show_publications === 1,
  reading: row.show_reading === 1,
  votes: row.show_votes === 1,
  follows: row.show_follows === 1,
  readerGlyph: row.show_reader_glyph === 1
});

export function createVisibility(repo: CommunityRepository, viewerId: string | null) {
  let followees: Set<string> | undefined;
  const follows = (userId: string): boolean => {
    if (viewerId === null) return false;
    followees ??= new Set(repo.listFollowees(viewerId));
    return followees.has(userId);
  };
  const make = (userId: string, published: boolean, settings: FeedSettings): Standing => ({
    published,
    isViewer: userId === viewerId,
    get followedByViewer() {
      return follows(userId);
    },
    settings
  });
  const cache = new Map<string, Standing>();
  const standing = (userId: string): Standing => {
    let found = cache.get(userId);
    if (!found) {
      found = make(userId, repo.getProfileRow(userId)?.published === 1, repo.getFeedSettings(userId) ?? DEFAULT_FEED_SETTINGS);
      cache.set(userId, found);
    }
    return found;
  };
  return {
    standing,
    standings(userIds: string[]): Map<string, Standing> {
      const found = new Map<string, Standing>();
      if (userIds.length === 0) return found;
      for (const row of repo.visibilityRows(userIds)) found.set(row.user_id, make(row.user_id, row.published === 1, settingsOf(row)));
      return found;
    },
    canViewContent: (userId: string): boolean => canViewContent(standing(userId)),
    isPrivate: (userId: string): boolean => isPrivate(standing(userId)),
    showsGlyph: (userId: string): boolean => showsGlyph(standing(userId)),
    canNameAsParticipant: (userId: string): boolean => canNameAsParticipant(standing(userId)),
    canFollow(userId: string): boolean {
      const s = standing(userId);
      return canFollow(s, !s.published && viewerId !== null && repo.getFollow(userId, viewerId) !== undefined);
    }
  };
}

export type Visibility = ReturnType<typeof createVisibility>;
