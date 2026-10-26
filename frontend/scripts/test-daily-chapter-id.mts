import assert from "node:assert/strict";
import { test } from "node:test";
import { isDailyChapterGuestId } from "@scripta/shared";
import { dailyChapterId } from "../src/lib/dailyChapterId.ts";

test("guest identities remain cryptographically generated UUIDs on LAN origins without randomUUID", () => {
  assert.ok(isDailyChapterGuestId(dailyChapterId()));
  const own = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    const first = dailyChapterId();
    const second = dailyChapterId();
    assert.ok(isDailyChapterGuestId(first));
    assert.ok(isDailyChapterGuestId(second));
    assert.notEqual(first, second);
  } finally {
    if (own) Object.defineProperty(crypto, "randomUUID", own);
    else delete (crypto as unknown as Record<string, unknown>).randomUUID;
  }
});
