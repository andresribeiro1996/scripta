import { existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

for (const path of process.argv.slice(2)) {
  if (!existsSync(path)) continue;
  const walPath = `${path}-wal`;
  const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
  const db = new DatabaseSync(path);
  let busy;
  try {
    ({ busy } = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get());
  } catch (error) {
    throw new Error(`truncate-wals: ${path}: ${error.message}`, { cause: error });
  } finally {
    db.close();
  }
  console.log(`truncate-wals: ${path} wal_bytes=${walBytes}${busy === 1 ? " busy, WAL left in place" : ""}`);
}
