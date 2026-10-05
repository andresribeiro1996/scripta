import type { TierlistData } from "@scripta/shared";
import type { PublicBook } from "./api";

function sectionIds(data: TierlistData, section: string) {
  return section === "pool" ? data.pool : data.tiers.find((tier) => tier.id === section)?.workIds ?? [];
}

function replaceSection(data: TierlistData, section: string, ids: string[]) {
  return section === "pool" ? { ...data, pool: ids } : { ...data, tiers: data.tiers.map((tier) => tier.id === section ? { ...tier, workIds: ids } : tier) };
}

export function moveBook(data: TierlistData, workId: string, direction: -1 | 1): TierlistData {
  const sections = [...data.tiers.map((tier) => tier.id), "pool"];
  const from = sections.find((section) => sectionIds(data, section).includes(workId));
  if (!from) return data;
  const target = sections[sections.indexOf(from) + direction];
  if (!target) return data;
  const without = replaceSection(data, from, sectionIds(data, from).filter((candidate) => candidate !== workId));
  return replaceSection(without, target, [...sectionIds(without, target), workId]);
}

export function moveBookTo(data: TierlistData, workId: string, target: string): TierlistData {
  const sections = [...data.tiers.map((tier) => tier.id), "pool"];
  const from = sections.find((section) => sectionIds(data, section).includes(workId));
  if (!from || from === target || !sections.includes(target)) return data;
  const without = replaceSection(data, from, sectionIds(data, from).filter((candidate) => candidate !== workId));
  return replaceSection(without, target, [...sectionIds(without, target), workId]);
}

export function reorderBook(data: TierlistData, workId: string, direction: -1 | 1): TierlistData {
  const section = [...data.tiers.map((tier) => tier.id), "pool"].find((candidate) => sectionIds(data, candidate).includes(workId));
  if (!section) return data;
  const ids = [...sectionIds(data, section)];
  const index = ids.indexOf(workId);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return data;
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  return replaceSection(data, section, ids);
}

export function votingBooks(books: PublicBook[]): Array<Record<string, unknown>> {
  return books.map((book) => ({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId, _coverUrl: book.coverUrl, _key: book.key, _workId: book.workId ?? undefined }));
}
