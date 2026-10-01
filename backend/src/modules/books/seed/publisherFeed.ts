import { canonicalIsbn } from "@scripta/shared";
import { normalizeWords } from "../domain/normalize.js";
import type { PublisherSite } from "./publishers.js";

export interface PublisherBook {
  isbn: string | null;
  title: string;
  author: string | null;
  imageUrl: string;
  productUrl: string;
  rank: number;
  details: ProductDetails;
}

export interface ProductDetails {
  summary: string | null;
  pages: number | null;
  year: number | null;
  translator: string | null;
}

export type ResolvedBook = PublisherBook & { isbn: string };

export const PAGE_RANK = 3;
const LABEL_REACH = 40;

const ISBN_CANDIDATE = /(?<!\d)97[89](?:[\p{Pd}\s.]?\d){10}(?!\d)/gu;
const ISBN10_CANDIDATE = /(?<!\d)\d(?:[\p{Pd}\s.]?\d){8}[\p{Pd}\s.]?[\dXx](?![\dXx])/gu;
const PORTUGAL_PREFIX = /^978(?:972|989)/;
const BLOCK_TAG = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi;
const SHOP_NOTICE = /pr[ée]-venda|envios|portes|stock|esgotado/i;
const NOTICE_REACH = 200;
const MIN_SYNOPSIS = 80;
const MIN_PAGES = 8;
const MAX_PAGES = 5000;
const FIRST_YEAR = 1900;
const PAGES_ATTRIBUTE = /p[áa]ginas|n[úu]m\.? ?p[áa]g/i;
const PAGES_TEXT = /(?<!\d)(\d{2,4})\s*(?:p[áa]g(?:inas|s)?\.?)(?![a-z])/i;
const TRANSLATOR_ATTRIBUTE = /^tradu/i;
const TRANSLATOR_TEXT = /Tradu(?:ção|zido)(?: de| por)?:?\s*([^\n.;|]{3,60})/i;
const YEAR_ATTRIBUTE = /^(ano|data|edi[cç][aã]o)/i;
const YEAR_VALUE = /(?<!\d)(?:19|20)\d{2}(?!\d)/;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function checksumOk(digits: string): boolean {
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

function isbn10Ok(digits: string): boolean {
  const sum = [...digits].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
  return sum % 11 === 0;
}

function isbn13s(text: string): { isbn: string; index: number }[] {
  return [...text.matchAll(ISBN_CANDIDATE)].flatMap((match) => {
    const digits = match[0].replace(/\D/g, "");
    return checksumOk(digits) ? [{ isbn: digits, index: match.index }] : [];
  });
}

function pageIsbns(text: string): { isbn: string; index: number }[] {
  const masked = text.replace(ISBN_CANDIDATE, (match) => "#".repeat(match.length));
  const tens = [...masked.matchAll(ISBN10_CANDIDATE)].flatMap((match) => {
    const digits = match[0].replace(/[^\dXx]/g, "").toUpperCase();
    return isbn10Ok(digits) ? [{ isbn: canonicalIsbn(digits), index: match.index }] : [];
  });
  return [...isbn13s(text), ...tens].sort((a, b) => a.index - b.index);
}

export function findPortugalIsbn(text: string): string | null {
  return isbn13s(text).find(({ isbn }) => PORTUGAL_PREFIX.test(isbn))?.isbn ?? null;
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(BLOCK_TAG, "\n").replace(/<[^>]*>/g, " "));
}

function synopsis(html: string): string | null {
  const lines = plainText(html)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "" && !SHOP_NOTICE.test(line.slice(0, NOTICE_REACH)));
  const joined = lines.join("\n\n");
  return joined.length >= MIN_SYNOPSIS ? joined : null;
}

function pageCount(value: string | null | undefined): number | null {
  const count = Number(value?.match(/\d+/)?.[0]);
  return count >= MIN_PAGES && count <= MAX_PAGES ? count : null;
}

function publicationYear(value: string | null): number | null {
  const year = Number(value?.match(YEAR_VALUE)?.[0]);
  return year >= FIRST_YEAR && year <= new Date().getFullYear() ? year : null;
}

function textDetails(text: string): Pick<ProductDetails, "pages" | "translator"> {
  return { pages: pageCount(PAGES_TEXT.exec(text)?.[1]), translator: TRANSLATOR_TEXT.exec(text)?.[1]?.trim() || null };
}

export function withPageText(details: ProductDetails, html: string): ProductDetails {
  const page = textDetails(plainText(html));
  return { ...details, pages: details.pages ?? page.pages, translator: details.translator ?? page.translator };
}

export function findPageIsbn(html: string): string | null {
  const content = decodeEntities(html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " "));
  const found = pageIsbns(content);
  const labelEnds = [...content.matchAll(/ISBN/gi)].map((label) => label.index + label[0].length);
  const labelled = found.filter(({ index }) => labelEnds.some((end) => index >= end && index - end <= LABEL_REACH));
  const distinct = [...new Set((labelled.length > 0 ? labelled : found).map(({ isbn }) => isbn))];
  return distinct.length === 1 && PORTUGAL_PREFIX.test(distinct[0]!) ? distinct[0]! : null;
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
    const productUrl = `${site.origin}/products/${handle}`;
    if (!found && !URL.canParse(productUrl)) return [];
    const vendor = text(product.vendor).trim();
    const author = site.authorFromVendor && vendor && normalizeWords(vendor) !== normalizeWords(site.name) ? vendor : null;
    const body = text(product.body_html);
    const details = { summary: synopsis(body), year: null, ...textDetails(plainText(body)) };
    return [{ isbn: found?.isbn ?? null, rank: found?.rank ?? PAGE_RANK, title, author, imageUrl, productUrl, details }];
  });
}

function wooAttribute(product: Record<string, unknown>, name: RegExp): string | null {
  const names = (Array.isArray(product.attributes) ? product.attributes : []).flatMap((item) => {
    const attribute = record(item);
    if (!attribute || !name.test(text(attribute.name))) return [];
    return (Array.isArray(attribute.terms) ? attribute.terms : []).map((term) => decodeEntities(text(record(term)?.name)).trim()).filter(Boolean);
  });
  return names.length > 0 ? names.join(", ") : null;
}

function wooDetails(product: Record<string, unknown>): ProductDetails {
  const description = text(product.description);
  const shortDescription = text(product.short_description);
  const fromText = textDetails(plainText(`${description}\n${shortDescription}`));
  return {
    summary: synopsis(description) ?? synopsis(shortDescription),
    pages: pageCount(wooAttribute(product, PAGES_ATTRIBUTE)) ?? fromText.pages,
    year: publicationYear(wooAttribute(product, YEAR_ATTRIBUTE)),
    translator: wooAttribute(product, TRANSLATOR_ATTRIBUTE) ?? fromText.translator
  };
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
    if (!found && !URL.canParse(productUrl)) return [];
    return [{ isbn: found?.isbn ?? null, rank: found?.rank ?? PAGE_RANK, title, author: wooAttribute(product, /^autor/i), imageUrl, productUrl, details: wooDetails(product) }];
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
