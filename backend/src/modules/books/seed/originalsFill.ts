import { firstAuthor, normalizeTitle, titleNumbers } from "@scripta/shared";
import type { OpenLibraryWork } from "../adapters/openlibrary/openLibraryCatalog.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { evidenceOf, hasVolumeMarker, mainTitle, mentionsSurname, originalKey, sameMainTitle, seriesLikeOriginals, surnameOf, titlePattern } from "../domain/translation.js";
import { JEV_REJECTION_LIMIT } from "../synopsisJudgments.js";
import { runCodeSteps } from "../translationBacklog.js";
import type { TranslationDeps } from "../translationJudgments.js";
import { seedBook } from "./seedCatalog.js";

export type FoundOriginal = { key: string; title: string; author: string };

export function pickOriginal(works: OpenLibraryWork[], originalTitle: string, authorTexts: string[]): FoundOriginal | null {
  const main = mainTitle(originalTitle);
  const wanted = normalizeTitle(main);
  const numbers = titleNumbers(main);
  for (const work of works) {
    if (normalizeTitle(work.title) !== wanted || titleNumbers(work.title) !== numbers || hasVolumeMarker(work.title)) continue;
    const author = work.authors.find((name) => {
      const surname = surnameOf(name);
      return surname !== null && mentionsSurname(authorTexts, surname);
    });
    if (author !== undefined) return { key: work.key, title: work.title, author };
  }
  return null;
}

export type OriginalsReport = {
  held: number;
  selected: number;
  noOriginal: number;
  seriesLike: number;
  volume: number;
  present: number;
  noAuthor: number;
  sharedOriginal: number;
  lookups: number;
  found: number;
  notFound: number;
  added: number;
  existing: number;
  codeMerges: number;
  codeBlocked: number;
  noCandidates: number;
  failed: string[];
  ask: string[];
  originals: Array<{ originalTitle: string; author: string; works: Array<{ workId: string; title: string }>; found: FoundOriginal | null }>;
};

type Group = { originalTitle: string; author: string; works: Array<{ workId: string; title: string }>; authorTexts: string[]; titleKeys: Set<string | null> };

const PROGRESS_EVERY = 10;

export async function fillOriginals(
  deps: TranslationDeps & { search: (title: string, author: string) => Promise<OpenLibraryWork[]>; log: (line: string) => void },
  heldWorkIds: string[],
  { dryRun }: { dryRun: boolean }
): Promise<OriginalsReport> {
  const { repo } = deps;
  const held = new Set(repo.canonicalWorkIds(heldWorkIds).values());
  const works = repo.portugueseWorksNeedingMatch([...held], Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, new Date(deps.now()).toISOString());
  const report: OriginalsReport = { held: held.size, selected: works.length, noOriginal: 0, seriesLike: 0, volume: 0, present: 0, noAuthor: 0, sharedOriginal: 0, lookups: 0, found: 0, notFound: 0, added: 0, existing: 0, codeMerges: 0, codeBlocked: 0, noCandidates: 0, failed: [], ask: [], originals: [] };
  const isSeriesLike = seriesLikeOriginals(repo.originalTitleClaims());
  const present: string[] = [];
  const groups = new Map<string, Group>();
  for (const workId of works) {
    const rows = repo.translationEvidence(workId);
    if (!rows) continue;
    const evidence = evidenceOf(rows);
    const original = evidence.originalTitle;
    const author = evidence.workAuthor || evidence.author;
    if (!original || originalKey(original) === null || sameMainTitle(original, evidence.title)) report.noOriginal++;
    else if (isSeriesLike(original, author)) report.seriesLike++;
    else if (hasVolumeMarker(evidence.title) || hasVolumeMarker(original)) report.volume++;
    else if (repo.titleCandidates(titlePattern(original)!).some((id) => id !== workId)) {
      report.present++;
      present.push(workId);
    } else if (surnameOf(author) === null) report.noAuthor++;
    else {
      const key = `${originalKey(original)}#${surnameOf(author)}`;
      const group = groups.get(key) ?? { originalTitle: mainTitle(original), author: firstAuthor(author), works: [], authorTexts: [], titleKeys: new Set() };
      group.works.push({ workId, title: evidence.title });
      group.authorTexts.push(evidence.workAuthor, evidence.author);
      group.titleKeys.add(originalKey(evidence.title));
      groups.set(key, group);
    }
  }
  const looked: Group[] = [];
  for (const group of groups.values()) {
    if (group.titleKeys.size >= 2) report.sharedOriginal += group.works.length;
    else looked.push(group);
  }
  report.lookups = looked.length;
  for (const [index, group] of looked.entries()) {
    let answer: OpenLibraryWork[] | null = null;
    try {
      answer = await deps.search(group.originalTitle, group.author);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError) || error.status === 429) throw error;
      report.failed.push(group.originalTitle);
    }
    const found = answer && pickOriginal(answer, group.originalTitle, group.authorTexts);
    if (found) report.found++;
    else if (answer) report.notFound++;
    report.originals.push({ originalTitle: group.originalTitle, author: group.author, works: group.works, found });
    if ((index + 1) % PROGRESS_EVERY === 0) deps.log(JSON.stringify({ looked: index + 1, of: looked.length, found: report.found }));
  }
  if (dryRun) return report;
  const workIds = [...present];
  for (const { found, works: served } of report.originals) {
    if (!found) continue;
    const seeded = seedBook({ isbn: "", title: found.title, author: found.author, workKey: found.key }, repo, () => new Date(deps.now()), "seed");
    if (seeded.outcome === "invalid") throw new Error(`Could not add the original "${found.title}"`);
    if (seeded.outcome === "created") report.added++;
    else report.existing++;
    workIds.push(...served.map((work) => work.workId));
  }
  if (workIds.length > 0) {
    const steps = runCodeSteps(deps, workIds);
    report.codeMerges = steps.codeMerges;
    report.codeBlocked = steps.codeBlocked;
    report.noCandidates = steps.noCandidates;
    report.ask = steps.ask;
  }
  return report;
}
