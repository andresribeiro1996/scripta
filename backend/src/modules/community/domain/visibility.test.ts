import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FEED_SETTINGS, type FeedSettings } from "@scripta/shared/community";
import type { CommunityRepository, VisibilityRow } from "./ports.js";
import type { ProfileRow } from "./types.js";
import { canFollow, canNameAsParticipant, canViewContent, createVisibility, isPrivate, readerListing, showsGlyph, type Standing } from "./visibility.js";

const standing = (over: Partial<Standing> = {}): Standing => ({ published: false, isViewer: false, followedByViewer: false, settings: DEFAULT_FEED_SETTINGS, ...over });
const on = (over: Partial<FeedSettings>): FeedSettings => ({ ...DEFAULT_FEED_SETTINGS, ...over });

test("content is visible when published or to the owner", () => {
  assert.equal(canViewContent(standing()), false);
  assert.equal(canViewContent(standing({ published: true })), true);
  assert.equal(canViewContent(standing({ isViewer: true })), true);
  assert.equal(canViewContent(standing({ followedByViewer: true, settings: on({ reading: true }) })), false);
  assert.equal(isPrivate(standing()), true);
  assert.equal(isPrivate(standing({ isViewer: true })), false);
  assert.equal(isPrivate(standing({ published: true })), false);
});

test("the glyph needs a published profile and the glyph switch", () => {
  assert.equal(showsGlyph(standing({ published: true, settings: on({ readerGlyph: true }) })), true);
  assert.equal(showsGlyph(standing({ published: true })), false);
  assert.equal(showsGlyph(standing({ settings: on({ readerGlyph: true }) })), false);
});

test("participants are named only when published with votes shown", () => {
  assert.equal(canNameAsParticipant(standing({ published: true })), true);
  assert.equal(canNameAsParticipant(standing({ published: true, settings: on({ votes: false }) })), false);
  assert.equal(canNameAsParticipant(standing({ settings: on({ votes: true }) })), false);
});

test("an unpublished reader can be followed only by someone they follow", () => {
  assert.equal(canFollow(standing({ published: true }), false), true);
  assert.equal(canFollow(standing(), true), true);
  assert.equal(canFollow(standing(), false), false);
});

test("reader listings follow publication, follows and reading sharing", () => {
  assert.deepEqual(readerListing(standing({ published: true })), { followed: false, published: true, showGlyph: false });
  assert.deepEqual(readerListing(standing({ published: true, followedByViewer: true })), { followed: true, published: true, showGlyph: false });
  assert.deepEqual(readerListing(standing({ followedByViewer: true, settings: on({ reading: true }) })), { followed: true, published: false, showGlyph: false });
  assert.equal(readerListing(standing({ followedByViewer: true })), undefined);
  assert.equal(readerListing(standing({ settings: on({ reading: true }) })), undefined);
  assert.deepEqual(readerListing(standing({ published: true, settings: on({ readerGlyph: true }) })), { followed: false, published: true, showGlyph: true });
});

test("isViewer only affects content", () => {
  const self = standing({ isViewer: true, settings: on({ readerGlyph: true, votes: true, reading: true }) });
  assert.equal(canViewContent(self), true);
  assert.equal(showsGlyph(self), false);
  assert.equal(canNameAsParticipant(self), false);
  assert.equal(canFollow(self, false), false);
  assert.equal(readerListing(self), undefined);
});

function fakeRepo(profiles: Record<string, { published: number; settings?: FeedSettings }>, follows: Array<[string, string]>) {
  const calls = { getProfileRow: 0, getFeedSettings: 0, listFollowees: 0, getFollow: 0, visibilityRows: 0 };
  const row = (id: string): ProfileRow => ({ user_id: id, published: profiles[id]!.published, mural_id: null, published_at: null, updated_at: "2026-10-07T00:00:00.000Z", feed_settings: null });
  const repo = {
    getProfileRow(id: string) { calls.getProfileRow++; return profiles[id] ? row(id) : undefined; },
    getFeedSettings(id: string) { calls.getFeedSettings++; return profiles[id]?.settings ?? null; },
    listFollowees(id: string) { calls.listFollowees++; return follows.filter(([from]) => from === id).map(([, to]) => to); },
    getFollow(from: string, to: string) { calls.getFollow++; return follows.some(([a, b]) => a === from && b === to) ? { follower_id: from, followee_id: to, created_at: "" } : undefined; },
    visibilityRows(ids: string[]): VisibilityRow[] {
      calls.visibilityRows++;
      return ids.filter((id) => profiles[id]).map((id) => {
        const s = profiles[id]!.settings ?? DEFAULT_FEED_SETTINGS;
        return { user_id: id, published: profiles[id]!.published, show_publications: Number(s.publications), show_reading: Number(s.reading), show_votes: Number(s.votes), show_follows: Number(s.follows), show_reader_glyph: Number(s.readerGlyph ?? false) };
      });
    }
  } as unknown as CommunityRepository;
  return { repo, calls };
}

test("a user with no profile row reads as unpublished with default settings", () => {
  const { repo } = fakeRepo({}, []);
  const visibility = createVisibility(repo, "viewer");
  assert.deepEqual({ ...visibility.standing("ghost") }, { published: false, isViewer: false, followedByViewer: false, settings: DEFAULT_FEED_SETTINGS });
  assert.equal(visibility.isPrivate("ghost"), true);
  assert.equal(createVisibility(repo, "ghost").canViewContent("ghost"), true);
});

test("standings are read once per user and followees lazily and once", () => {
  const { repo, calls } = fakeRepo({ a: { published: 1, settings: on({ readerGlyph: true }) }, b: { published: 0 } }, [["viewer", "b"]]);
  const visibility = createVisibility(repo, "viewer");
  assert.equal(visibility.showsGlyph("a"), true);
  assert.equal(visibility.showsGlyph("a"), true);
  assert.equal(calls.getProfileRow, 1);
  assert.equal(calls.getFeedSettings, 1);
  assert.equal(calls.listFollowees, 0);
  assert.equal(visibility.standing("b").followedByViewer, true);
  assert.equal(visibility.standing("a").followedByViewer, false);
  assert.equal(calls.listFollowees, 1);
});

test("a signed-out reader never reads followees", () => {
  const { repo, calls } = fakeRepo({ a: { published: 1 } }, []);
  assert.equal(createVisibility(repo, null).standing("a").followedByViewer, false);
  assert.equal(calls.listFollowees, 0);
});

test("canFollow checks the reverse follow only for an unpublished target", () => {
  const { repo, calls } = fakeRepo({ pub: { published: 1 }, priv: { published: 0 } }, [["priv", "me"]]);
  const visibility = createVisibility(repo, "me");
  assert.equal(visibility.canFollow("pub"), true);
  assert.equal(calls.getFollow, 0);
  assert.equal(visibility.canFollow("priv"), true);
  assert.equal(createVisibility(repo, "other").canFollow("priv"), false);
});

test("standings batch one rows query and skip users without a profile row", () => {
  const { repo, calls } = fakeRepo({ a: { published: 1 }, b: { published: 0, settings: on({ reading: true }) } }, [["viewer", "b"]]);
  const map = createVisibility(repo, "viewer").standings(["a", "b", "ghost"]);
  assert.deepEqual([...map.keys()], ["a", "b"]);
  assert.equal(map.get("b")!.settings.reading, true);
  assert.equal(map.get("b")!.followedByViewer, true);
  assert.equal(calls.visibilityRows, 1);
  assert.equal(calls.getProfileRow, 0);
  assert.equal(createVisibility(repo, "viewer").standings([]).size, 0);
});
