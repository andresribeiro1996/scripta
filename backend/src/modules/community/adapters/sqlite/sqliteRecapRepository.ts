import type { DatabaseSync } from "node:sqlite";
import { recapHasCards, type RecapData } from "../../topShelfRecap.js";

export interface RecapRepository {
  newest(): string | null;
  get(month: string): RecapData | null;
  put(month: string, data: RecapData, frozenAt: string): void;
  months(): string[];
}

export function createRecapRepository(db: DatabaseSync): RecapRepository {
  const newest = db.prepare("SELECT month FROM top_shelf_recaps ORDER BY month DESC LIMIT 1");
  const get = db.prepare("SELECT data FROM top_shelf_recaps WHERE month = ? AND has_cards = 1");
  const put = db.prepare("INSERT OR IGNORE INTO top_shelf_recaps (month, data, has_cards, frozen_at) VALUES (?, ?, ?, ?)");
  const months = db.prepare("SELECT month FROM top_shelf_recaps WHERE has_cards = 1 ORDER BY month DESC");
  return {
    newest: () => (newest.get() as { month: string } | undefined)?.month ?? null,
    get(month) {
      const row = get.get(month) as { data: string } | undefined;
      return row ? (JSON.parse(row.data) as RecapData) : null;
    },
    put(month, data, frozenAt) {
      put.run(month, JSON.stringify(data), recapHasCards(data) ? 1 : 0, frozenAt);
    },
    months: () => (months.all() as Array<{ month: string }>).map((r) => r.month),
  };
}
