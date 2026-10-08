const ROMAN: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let out = "";
  let rest = n;
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

export interface NameParts { first: string; last: string | null }

const partsOf = (readerName: string) => readerName.split(/[._]+/).filter(Boolean);

export function nameParts(readerName: string): NameParts {
  const parts = partsOf(readerName);
  if (parts.length < 2) return { first: parts[0] ?? readerName, last: null };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

export function displayName(readerName: string): string {
  const parts = partsOf(readerName);
  return (parts.length ? parts : [readerName]).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
