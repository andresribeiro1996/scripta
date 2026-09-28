import { env } from "../../config/env.js";
import { openWaitlistDb } from "./adapters/sqlite/connection.js";
import { createSqliteWaitlistRepository } from "./adapters/sqlite/sqliteWaitlistRepository.js";
import { waitlistCsv } from "./csv.js";
import { createWaitlistService } from "./service.js";

const db = openWaitlistDb();
const entries = createWaitlistService(createSqliteWaitlistRepository(db)).list();
db.close();

process.stdout.write(waitlistCsv(entries));
console.error(`Exported ${entries.length} ${entries.length === 1 ? "address" : "addresses"} from ${env.WAITLIST_DB_PATH}`);
