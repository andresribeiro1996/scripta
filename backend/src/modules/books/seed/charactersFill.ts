import type { CleanedSubjects } from "../domain/workSubjects.js";
import type { BooksRepository } from "../domain/ports.js";

export const CHARACTER_BATCH = 100;

export interface CharactersReport {
  works: number;
  returned: number;
  withPeople: number;
  quizReady: number;
  gatedOut: number;
  rows: { person: number; place: number; time: number };
  sample: Array<{ key: string; people: string[] }>;
}

export async function fillCharacters(
  repo: Pick<BooksRepository, "transaction" | "worksWithOpenLibraryKey" | "replaceWorkSubjects">,
  fetchBatch: (keys: string[]) => Promise<Map<string, CleanedSubjects>>,
  at: string,
  { dryRun, log }: { dryRun: boolean; log: (line: string) => void }
): Promise<CharactersReport> {
  const works = repo.worksWithOpenLibraryKey();
  const report: CharactersReport = { works: works.length, returned: 0, withPeople: 0, quizReady: 0, gatedOut: 0, rows: { person: 0, place: 0, time: 0 }, sample: [] };
  for (let start = 0; start < works.length; start += CHARACTER_BATCH) {
    const batch = works.slice(start, start + CHARACTER_BATCH);
    const found = await fetchBatch(batch.map((work) => work.olWorkKey));
    const writes: Array<{ id: string; subjects: CleanedSubjects["subjects"] }> = [];
    for (const { id, olWorkKey } of batch) {
      const cleaned = found.get(olWorkKey);
      if (!cleaned) continue;
      const { subjects, gatedOut } = cleaned;
      report.returned++;
      if (gatedOut) report.gatedOut++;
      if (subjects.person.length > 0) {
        report.withPeople++;
        if (subjects.person.length >= 3) report.quizReady++;
        if (report.sample.length < 20) report.sample.push({ key: olWorkKey, people: subjects.person.slice(0, 5) });
      }
      report.rows.person += subjects.person.length;
      report.rows.place += subjects.place.length;
      report.rows.time += subjects.time.length;
      writes.push({ id, subjects });
    }
    if (!dryRun) repo.transaction(() => writes.forEach(({ id, subjects }) => repo.replaceWorkSubjects(id, subjects, at)));
    log(JSON.stringify({ done: Math.min(start + CHARACTER_BATCH, works.length), of: works.length, returned: report.returned }));
  }
  return report;
}
