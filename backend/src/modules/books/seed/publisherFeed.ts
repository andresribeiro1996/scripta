import { normalizeWords } from "../domain/normalize.js";
import type { PublisherSite } from "./publishers.js";

export interface PublisherBook {
  isbn: string | null;
  title: string;
  author: string | null;
  imageUrl: string;
  productUrl: string;
  rank: number;
}

export type ResolvedBook = PublisherBook & { isbn: string };

export const PAGE_RANK = 3;
const LABEL_REACH = 40;

const ISBN_CANDIDATE = /(?<!\d)97[89](?:[\p{Pd}\s.]?\d){10}(?!\d)/gu;
const PORTUGAL_PREFIX = /^978(?:972|989)/;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function checksumOk(digits: string): boolean {
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

function portugalIsbns(text: string): { isbn: string; index: number }[] {
  return [...text.matchAll(ISBN_CANDIDATE)].flatMap((match) => {
    const digits = match[0].replace(/\D/g, "");
    return PORTUGAL_PREFIX.test(digits) && checksumOk(digits) ? [{ isbn: digits, index: match.index }] : [];
  });
}

export function findPortugalIsbn(text: string): string | null {
  return portugalIsbns(text)[0]?.isbn ?? null;
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export function findPageIsbn(html: string): string | null {
  const content = decodeEntities(html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " "));
  const found = portugalIsbns(content);
  const labelEnds = [...content.matchAll(/ISBN/gi)].map((label) => label.index + label[0].length);
  const labelled = found.find(({ index }) => labelEnds.some((end) => index >= end && index - end <= LABEL_REACH));
  if (labelled) return labelled.isbn;
  const distinct = new Set(found.map(({ isbn }) => isbn));
  return distinct.size === 1 ? [...distinct][0]! : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fileName(url: string): string {
  return url.split("?")[0]!.split("/").pop() ?? "";
}

function firstIsbn(steps: string[][]): { isbn: string; rank: number } | null {
  for (const [rank, candidates] of steps.entries()) {
    for (const candidate of candidates) {
      const isbn = findPortugalIsbn(candidate);
      if (isbn) return { isbn, rank };
    }
  }
  return null;
}

function items(list: unknown): unknown[] {
  return Array.isArray(list) ? list : [];
}

export function feedProducts(json: unknown, site: PublisherSite): unknown[] | null {
  const list = site.platform === "shopify" ? record(json)?.products : json;
  return Array.isArray(list) ? list : null;
}

export function feedUrl(site: PublisherSite, page: number): string {
  return site.platform === "shopify" ? `${site.origin}/products.json?limit=250&page=${page}` : `${site.origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`;
}

export function parseShopifyProducts(json: unknown, site: PublisherSite): PublisherBook[] {
  return items(record(json)?.products).flatMap((item) => {
    const product = record(item);
    if (!product) return [];
    const imageUrl = text(record(Array.isArray(product.images) ? product.images[0] : null)?.src);
    const handle = text(product.handle);
    const title = text(product.title).trim();
    if (!imageUrl || !handle || !title) return [];
    const variants = (Array.isArray(product.variants) ? product.variants : []).map(record).filter((variant) => variant !== null);
    const found = firstIsbn([
      [...variants.map((variant) => text(variant.barcode)), ...variants.map((variant) => text(variant.sku))],
      [fileName(imageUrl)],
      [JSON.stringify(product)]
    ]);
    const vendor = text(product.vendor).trim();
    const author = site.authorFromVendor && vendor && normalizeWords(vendor) !== normalizeWords(site.name) ? vendor : null;
    return [{ isbn: found?.isbn ?? null, rank: found?.rank ?? PAGE_RANK, title, author, imageUrl, productUrl: `${site.origin}/products/${handle}` }];
  });
}

function wooAuthor(product: Record<string, unknown>): string | null {
  const names = (Array.isArray(product.attributes) ? product.attributes : []).flatMap((item) => {
    const attribute = record(item);
    if (!attribute || !/^autor/i.test(text(attribute.name))) return [];
    return (Array.isArray(attribute.terms) ? attribute.terms : []).map((term) => decodeEntities(text(record(term)?.name)).trim()).filter(Boolean);
  });
  return names.length > 0 ? names.join(", ") : null;
}

export function parseWooProducts(json: unknown, site: PublisherSite): PublisherBook[] {
  return items(json).flatMap((item) => {
    const product = record(item);
    if (!product) return [];
    const imageUrl = text(record(Array.isArray(product.images) ? product.images[0] : null)?.src);
    const productUrl = text(product.permalink);
    const title = decodeEntities(text(product.name)).trim();
    if (!imageUrl || !productUrl || !title) return [];
    const found = firstIsbn([[text(product.sku)], [fileName(imageUrl)], [JSON.stringify(product)]]);
    return [{ isbn: found?.isbn ?? null, rank: found?.rank ?? PAGE_RANK, title, author: wooAuthor(product), imageUrl, productUrl }];
  });
}

export function parseRobots(content: string): { disallow: string[]; crawlDelayMs: number | null } {
  const disallow: string[] = [];
  let crawlDelayMs: number | null = null;
  let inGroup = false;
  let afterAgent = false;
  for (const line of content.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).split("#")[0]!.trim();
    if (field === "user-agent") {
      inGroup = (afterAgent && inGroup) || value === "*";
      afterAgent = true;
      continue;
    }
    afterAgent = false;
    if (!inGroup) continue;
    if (field === "disallow" && value) disallow.push(value);
    if (field === "crawl-delay" && value !== "" && Number.isFinite(Number(value))) crawlDelayMs = Number(value) * 1000;
  }
  return { disallow, crawlDelayMs };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isDisallowed(path: string, disallow: string[]): boolean {
  return disallow.some((rule) => {
    const anchored = rule.endsWith("$");
    const pattern = (anchored ? rule.slice(0, -1) : rule).split("*").map(escapeRegExp).join(".*");
    return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
  });
}
