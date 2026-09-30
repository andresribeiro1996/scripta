import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AwsClient } from "aws4fetch";

const OBJECT_KEY = /^(covers|gallery|avatars)\/[0-9a-f-]{36}(-thumb)?\.webp$/;
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const { values: dirs } = parseArgs({
  options: {
    covers: { type: "string", default: "/data/covers-files" },
    gallery: { type: "string", default: "/data/gallery-files" },
    avatars: { type: "string", default: "/data/avatar-files" }
  }
});

const required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_IMAGES_BUCKET"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_IMAGES_BUCKET } = process.env;
const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });

async function list(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`${dir}: missing, nothing to copy`);
      return [];
    }
    throw error;
  }
}

async function planCovers(dir) {
  const files = (await list(dir)).filter((entry) => entry.isFile()).map((entry) => entry.name);
  const names = new Set(files);
  const plan = [];
  for (const name of files) {
    plan.push({ kind: "covers", key: `covers/${name}`, path: join(dir, name) });
    const full = /^([0-9a-f-]{36})\.webp$/.exec(name);
    if (full && !names.has(`${full[1]}-thumb.webp`)) {
      plan.push({ kind: "covers", key: `covers/${full[1]}-thumb.webp`, path: join(dir, name), fromFull: true });
    }
  }
  return plan;
}

async function planPerUser(kind, dir) {
  const plan = [];
  for (const user of (await list(dir)).filter((entry) => entry.isDirectory())) {
    for (const file of (await list(join(dir, user.name))).filter((entry) => entry.isFile())) {
      plan.push({ kind, key: `${kind}/${file.name}`, path: join(dir, user.name, file.name) });
    }
  }
  return plan;
}

const plan = [...(await planCovers(dirs.covers)), ...(await planPerUser("gallery", dirs.gallery)), ...(await planPerUser("avatars", dirs.avatars))];

const counts = {};
const failures = [];
const tally = (kind, field) => {
  counts[kind] ??= { uploaded: 0, skipped: 0, thumbsFromFull: 0 };
  counts[kind][field] += 1;
};

for (const item of plan) {
  if (!OBJECT_KEY.test(item.key)) {
    console.log(`skip ${item.path}: ${item.key} is not a valid object key`);
    tally(item.kind, "skipped");
    continue;
  }
  console.log(`${item.path} -> ${item.key}${item.fromFull ? " (thumb from full)" : ""}`);
  try {
    const res = await client.fetch(`${R2_ENDPOINT}/${R2_IMAGES_BUCKET}/${item.key}`, {
      method: "PUT",
      body: new Uint8Array(await readFile(item.path)),
      headers: { "Content-Type": "image/webp", "Cache-Control": CACHE_CONTROL }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tally(item.kind, "uploaded");
    if (item.fromFull) tally(item.kind, "thumbsFromFull");
  } catch (error) {
    failures.push(`${item.key} (${item.path}): ${error.cause?.code ?? error.message}`);
  }
}

for (const [kind, { uploaded, skipped, thumbsFromFull }] of Object.entries(counts)) {
  console.log(`${kind}: ${uploaded} uploaded (${thumbsFromFull} thumbs from full), ${skipped} skipped`);
}

if (failures.length > 0) {
  console.error(`${failures.length} failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
