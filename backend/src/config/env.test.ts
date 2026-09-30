import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

process.env.AUTH_DB_PATH = "/srv/volume/auth.sqlite";
process.env.LIBRARY_DB_PATH = "/srv/volume/library.sqlite";
process.env.GALLERY_DB_PATH = "/srv/volume/gallery.sqlite";
process.env.GALLERY_STORAGE_PATH = "/srv/volume/gallery-files";
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
delete process.env.WAITLIST_DB_PATH;

const { env } = await import("./env.js");

test("the waitlist database defaults to the directory that holds the accounts database", () => {
  assert.equal(env.WAITLIST_DB_PATH, "/srv/volume/waitlist.sqlite");
});

const requiredEnv = {
  DOTENV_CONFIG_PATH: "/nonexistent/.env",
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  GALLERY_STORAGE_PATH: "/data/gallery-files",
  AUTH_DB_PATH: "/data/auth.sqlite",
  LIBRARY_DB_PATH: "/data/library.sqlite",
  GALLERY_DB_PATH: "/data/gallery.sqlite"
};

function bootWithVolume(extra: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(import.meta.resolve("./env.js"))})`], {
    env: { PATH: process.env.PATH, RAILWAY_VOLUME_MOUNT_PATH: "/data", ...requiredEnv, ...extra },
    encoding: "utf8"
  });
}

test("on Railway, a database outside the volume fails the boot and names the variable", () => {
  const result = bootWithVolume({});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MURALS_DB_PATH: must be under the volume at \/data/);
  assert.doesNotMatch(result.stderr, /AUTH_DB_PATH/);
});

test("on Railway, every database under the volume boots", () => {
  const result = bootWithVolume({
    MURALS_DB_PATH: "/data/murals.sqlite",
    COVERS_DB_PATH: "/data/covers.sqlite",
    SOCIALS_DB_PATH: "/data/socials.sqlite",
    ARENA_DB_PATH: "/data/arena.sqlite",
    TIERLISTS_DB_PATH: "/data/tierlists.sqlite",
    QUIZZES_DB_PATH: "/data/quizzes.sqlite",
    COMMUNITY_DB_PATH: "/data/community.sqlite"
  });
  assert.equal(result.status, 0, result.stderr);
});
