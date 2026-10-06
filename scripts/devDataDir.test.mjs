import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateLegacyFiles } from "./devDataDir.mjs";

const a = "03c8eb69-9974-49fa-aca9-8a6d8a71a505";
const b = "90da0233-de49-4fc1-a4e9-f5de94f22bcb";
const c = "ed7843eb-00d3-48bf-8032-697bdb15c0a4";

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-devDataDir-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(path, contents) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

test("moves legacy covers into files/covers, copying a thumbnail from the full image when there is none", () => {
  withDir((dir) => {
    write(join(dir, "covers-files", `${a}.webp`), "a-full");
    write(join(dir, "covers-files", `${b}.webp`), "b-full");
    write(join(dir, "covers-files", `${b}-thumb.webp`), "b-thumb");

    migrateLegacyFiles(dir);

    const covers = join(dir, "files", "covers");
    assert.deepEqual(readdirSync(covers).sort(), [`${a}-thumb.webp`, `${a}.webp`, `${b}-thumb.webp`, `${b}.webp`]);
    assert.equal(readFileSync(join(covers, `${a}-thumb.webp`), "utf8"), "a-full");
    assert.equal(readFileSync(join(covers, `${b}-thumb.webp`), "utf8"), "b-thumb");
    assert.equal(existsSync(join(dir, "covers-files")), false);
  });
});

test("never overwrites a file already in files/", () => {
  withDir((dir) => {
    write(join(dir, "covers-files", `${a}.webp`), "legacy");
    write(join(dir, "files", "covers", `${a}.webp`), "current");
    write(join(dir, "files", "covers", `${a}-thumb.webp`), "current-thumb");

    migrateLegacyFiles(dir);

    assert.equal(readFileSync(join(dir, "files", "covers", `${a}.webp`), "utf8"), "current");
    assert.equal(readFileSync(join(dir, "files", "covers", `${a}-thumb.webp`), "utf8"), "current-thumb");
  });
});

test("flattens per-user avatar and gallery directories into files/avatars and files/gallery", () => {
  withDir((dir) => {
    write(join(dir, "avatar-files", c, `${a}.webp`), "avatar");
    write(join(dir, "gallery-files", c, `${b}.webp`), "gallery");

    migrateLegacyFiles(dir);

    assert.equal(readFileSync(join(dir, "files", "avatars", `${a}.webp`), "utf8"), "avatar");
    assert.equal(readFileSync(join(dir, "files", "gallery", `${b}.webp`), "utf8"), "gallery");
    assert.equal(existsSync(join(dir, "avatar-files")), false);
    assert.equal(existsSync(join(dir, "gallery-files")), false);
  });
});

test("does nothing on a directory already in the current layout", () => {
  withDir((dir) => {
    migrateLegacyFiles(dir);
    assert.deepEqual(readdirSync(dir), []);
  });
});
