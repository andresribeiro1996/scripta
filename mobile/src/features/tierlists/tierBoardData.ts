import type { TierlistData } from "@scripta/shared";

function sectionKeys(data: TierlistData, section: string) {
  return section === "pool" ? data.pool : data.tiers.find((tier) => tier.id === section)?.bookKeys ?? [];
}

function replaceSection(data: TierlistData, section: string, keys: string[]) {
  return section === "pool" ? { ...data, pool: keys } : { ...data, tiers: data.tiers.map((tier) => tier.id === section ? { ...tier, bookKeys: keys } : tier) };
}

export function moveBook(data: TierlistData, key: string, direction: -1 | 1): TierlistData {
  const sections = [...data.tiers.map((tier) => tier.id), "pool"];
  const from = sections.find((section) => sectionKeys(data, section).includes(key));
  if (!from) return data;
  const target = sections[sections.indexOf(from) + direction];
  if (!target) return data;
  const without = replaceSection(data, from, sectionKeys(data, from).filter((candidate) => candidate !== key));
  return replaceSection(without, target, [...sectionKeys(without, target), key]);
}

export function reorderBook(data: TierlistData, key: string, direction: -1 | 1): TierlistData {
  const section = [...data.tiers.map((tier) => tier.id), "pool"].find((candidate) => sectionKeys(data, candidate).includes(key));
  if (!section) return data;
  const keys = [...sectionKeys(data, section)];
  const index = keys.indexOf(key);
  const target = index + direction;
  if (target < 0 || target >= keys.length) return data;
  [keys[index], keys[target]] = [keys[target]!, keys[index]!];
  return replaceSection(data, section, keys);
}
