import { seriesOrder } from "./searchRank.js";
import { personNameKey } from "./workSubjects.js";
import type { CastRows } from "./types.js";
import type { WorkCast } from "@scripta/shared";

type Member = CastRows["members"][number];

function inSeriesOrder(members: Member[]): Member[] {
  const byId = [...members].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const order = seriesOrder(byId.map(({ id, position }) => ({ workId: id, position })));
  return order.map((id) => byId.find((member) => member.id === id)!);
}

export function buildCast(rows: CastRows, coverUrl: (imageId: string) => string): WorkCast {
  const { work, series } = rows;
  const scopeId = series ? `s:${series.nameKey}` : `w:${work.id}`;
  const found = new Map<string, { name: string; works: number; best: number }>();
  for (const member of inSeriesOrder(rows.members)) {
    const seen = new Set<string>();
    member.people.forEach((name, index) => {
      const key = personNameKey(name);
      if (key === null || seen.has(key)) return;
      seen.add(key);
      const entry = found.get(key);
      if (entry) {
        entry.works += 1;
        entry.best = Math.min(entry.best, index);
      } else {
        found.set(key, { name, works: 1, best: index });
      }
    });
  }
  const characters = [...found]
    .sort(([, a], [, b]) => b.works - a.works || a.best - b.best || a.name.localeCompare(b.name))
    .map(([key, { name, works }]) => ({ id: `ch:${scopeId}|${key}`, name, works }));
  return {
    scope: {
      kind: series ? "series" : "work",
      key: series ? series.nameKey : work.id,
      label: series ? series.name : work.title,
      coverUrl: work.coverImageId ? coverUrl(work.coverImageId) : null,
      workCount: rows.members.length
    },
    characters
  };
}
