import type { Binding } from "../adapters/wikidata/sparql.js";

export function wikipediaSitesFrom(bindings: Binding[]): Array<{ olWorkKey: string; sites: number }> {
  const sites = new Map<string, number>();
  for (const binding of bindings) {
    const olWorkKey = binding.id?.value;
    const count = Number(binding.n?.value);
    if (olWorkKey && Number.isInteger(count) && count >= 0) sites.set(olWorkKey, Math.max(sites.get(olWorkKey) ?? 0, count));
  }
  return [...sites].map(([olWorkKey, count]) => ({ olWorkKey, sites: count }));
}
