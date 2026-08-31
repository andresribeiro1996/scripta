// Copies existing gallery uploads and cached covers from local disk into
// object storage.
//
//   node --import tsx scripts/files-to-object-storage.mjs [--dry-run]
//
// Reads S3_* and the two *_STORAGE_PATH variables from the environment
// (or .env), the same ones the app itself uses — so if the app can reach
// the bucket, so can this.
//
// Writes through the same S3 adapters the app uses rather than issuing
// its own PutObject calls, so the keys are guaranteed to be the ones the
// app will later look for. A bespoke copy that got the prefix subtly
// wrong would appear to succeed and leave every image 404ing.
//
// NON-DESTRUCTIVE: local files are read, never deleted. Roll back by
// unsetting S3_BUCKET. Re-running is safe — every object is overwritten
// with identical bytes. Verified per file by reading the object back and
// comparing.
//
// Run it with the app STOPPED, or at least know that uploads made after a
// file's directory is listed will not be copied.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { env, useObjectStorage } from "../src/config/env.ts";
import { createS3ImageBlobStore } from "../src/modules/gallery/adapters/s3/s3ImageBlobStore.ts";
import { createS3CoverBlobStore } from "../src/modules/covers/adapters/s3/s3CoverBlobStore.ts";

const dryRun = process.argv.includes("--dry-run");

if (!useObjectStorage) {
  console.error("S3_BUCKET is not set — nothing to migrate to. Configure object storage first (see .env.example).");
  process.exit(1);
}

/** Splits "<id>.<extension>" the way the blob stores key their objects.
 *  A file that doesn't match is reported rather than guessed at. */
function splitName(filename) {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  return { id: filename.slice(0, dot), extension: filename.slice(dot + 1) };
}

let copied = 0;
let skipped = 0;
const failed = [];

async function copyOne(label, bytes, write, readBack) {
  if (dryRun) {
    console.log(`  would copy ${label} (${bytes.byteLength} bytes)`);
    copied++;
    return;
  }
  await write();
  const after = await readBack();
  if (!after || Buffer.compare(after, bytes) !== 0) {
    throw new Error("verification failed — the object read back does not match the local file");
  }
  console.log(`  copied ${label} (${bytes.byteLength} bytes)`);
  copied++;
}

// --- gallery uploads: one subdirectory per account ----------------------
const galleryRoot = env.GALLERY_STORAGE_PATH;
const images = createS3ImageBlobStore();

if (!existsSync(galleryRoot)) {
  console.log(`gallery: ${galleryRoot} does not exist — nothing to copy`);
} else {
  const userDirs = readdirSync(galleryRoot).filter((entry) => statSync(join(galleryRoot, entry)).isDirectory());
  console.log(`gallery: ${userDirs.length} account director${userDirs.length === 1 ? "y" : "ies"} under ${galleryRoot}`);

  for (const userId of userDirs) {
    for (const filename of readdirSync(join(galleryRoot, userId))) {
      const path = join(galleryRoot, userId, filename);
      if (!statSync(path).isFile()) continue;

      const parts = splitName(filename);
      if (!parts) {
        console.warn(`  skip   ${userId}/${filename} (not <id>.<extension>)`);
        skipped++;
        continue;
      }

      try {
        const bytes = readFileSync(path);
        await copyOne(
          `${userId}/${filename}`,
          bytes,
          () => images.save(userId, parts.id, parts.extension, bytes),
          () => images.read(userId, parts.id, parts.extension)
        );
      } catch (err) {
        console.error(`  FAILED ${userId}/${filename}: ${err instanceof Error ? err.message : String(err)}`);
        failed.push(`${userId}/${filename}`);
      }
    }
  }
}

// --- cached covers: flat, global to the install -------------------------
const coversRoot = env.COVERS_STORAGE_PATH;
const covers = createS3CoverBlobStore();

if (!existsSync(coversRoot)) {
  console.log(`covers: ${coversRoot} does not exist — nothing to copy`);
} else {
  const files = readdirSync(coversRoot).filter((entry) => statSync(join(coversRoot, entry)).isFile());
  console.log(`covers: ${files.length} cached cover${files.length === 1 ? "" : "s"} under ${coversRoot}`);

  for (const filename of files) {
    const parts = splitName(filename);
    if (!parts) {
      console.warn(`  skip   ${filename} (not <id>.<extension>)`);
      skipped++;
      continue;
    }

    try {
      const bytes = readFileSync(join(coversRoot, filename));
      await copyOne(
        filename,
        bytes,
        () => covers.save(parts.id, parts.extension, bytes),
        () => covers.read(parts.id, parts.extension)
      );
    } catch (err) {
      console.error(`  FAILED ${filename}: ${err instanceof Error ? err.message : String(err)}`);
      failed.push(filename);
    }
  }
}

console.log(`\n${dryRun ? "would copy" : "copied"} ${copied}, skipped ${skipped}, failed ${failed.length}`);
if (failed.length > 0) {
  console.error(`Failed: ${failed.join(", ")}`);
  console.error("Local files were not modified — fix the cause and re-run; re-copying is safe.");
  process.exit(1);
}

// The cover cache is disposable — a lost cover just re-resolves from Open
// Library/Google Books on next view. Gallery uploads are NOT: they are
// the user's own files with no other copy anywhere.
if (!dryRun) {
  console.log("\nLocal files are untouched. Verify the app serves images from the bucket before deleting them —");
  console.log("gallery uploads are user-supplied and exist nowhere else.");
}
