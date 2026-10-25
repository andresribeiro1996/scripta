import { existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function checkpoint(path) {
  const db = new DatabaseSync(path);
  try {
    return db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy;
  } finally {
    db.close();
  }
}

for (const path of process.argv.slice(2)) {
  if (!existsSync(path)) continue;
  const walPath = `${path}-wal`;
  const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
  let busy;
  try {
    busy = checkpoint(path);
  } catch (error) {
    throw new Error(`truncate-wals: ${path}: ${error.message}`, { cause: error });
  }
  console.log(`truncate-wals: ${path} wal_bytes=${walBytes}${busy === 1 ? " busy, WAL left in place" : ""}`);
}
