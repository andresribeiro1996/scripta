import { canonicalIsbn, cleanCatalogText, decodeHtmlEntities } from "@scripta/shared";
import { isValidIsbn } from "../domain/normalize.js";

export interface MarcField {
  tag: string;
  subfields: Array<[string, string]>;
}

export interface MarcRecord {
  id: string | null;
  datestamp: string | null;
  deleted: boolean;
  controls: Record<string, string>;
  fields: MarcField[];
}

export interface BnpBook {
  recordId: string | null;
  isbns: string[];
  title: string;
  author: string;
  translator: string | null;
  originalTitle: string | null;
  publisher: string | null;
  year: number | null;
  pages: number | null;
  languages: string[];
  udc: string[];
  summary: string | null;
  scanUrl: string | null;
}

const element = (name: string) => new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, "g");
const RECORD = /<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/g;
const HEADER = /<header\b([^>]*)>([\s\S]*?)<\/header>/;
const IDENTIFIER = /<identifier>([^<]*)<\/identifier>/;
const DATESTAMP = /<datestamp>([^<]*)<\/datestamp>/;
const CONTROLFIELD = element("controlfield");
const DATAFIELD = element("datafield");
const SUBFIELD = element("subfield");
const DELETED = /\bstatus="deleted"/;
const TAG = /\btag="([^"]*)"/;
const CODE = /\bcode="([^"]*)"/;
const ERROR_CODE = /<error\b[^>]*\bcode="([^"]*)"/;
const RESUMPTION_TOKEN = /<resumptionToken\b[^>]*>([^<]*)<\/resumptionToken>/;
const NO_RECORDS = "noRecordsMatch";
const LEADING_MARKERS = /^\?(\S+) \?/;
const ORIGINAL_TITLE = /^T[íi]t\. orig\.:\s*/;
const NO_PUBLISHER = /^(?:s\.\s*n\.)?$/i;
const YEAR_IN_TEXT = /(?:1[5-9]|20)\d{2}/;
const CODED_YEAR = /^(?:1[5-9]|20)\d{2}$/;
const TRAILING_SEPARATORS = /[\s;:,/]+$/;
const MAX_PAGES = 99_999;
const SCAN = "winlibimg.aspx";
const URL_IN_TEXT = /https?:\/\/\S+/i;
const TRANSLATOR = "730";
const AUTHOR_FALLBACKS = ["070", "340"];

const text = (raw: string | undefined) => structuredClone(decodeHtmlEntities(raw ?? ""));

function attribute(pattern: RegExp, attributes: string): string | undefined {
  return pattern.exec(attributes)?.[1];
}

export function readMarcRecords(xml: string): MarcRecord[] {
  return [...xml.matchAll(RECORD)].map(([, body = ""]) => {
    const header = HEADER.exec(body);
    const controls = [...body.matchAll(CONTROLFIELD)].map(([, attributes = "", value = ""]): [string, string] => [text(attribute(TAG, attributes)), text(value)]);
    const fields = [...body.matchAll(DATAFIELD)].map(([, attributes = "", content = ""]): MarcField => ({
      tag: text(attribute(TAG, attributes)),
      subfields: [...content.matchAll(SUBFIELD)].map(([, subAttributes = "", value = ""]): [string, string] => [text(attribute(CODE, subAttributes)), text(value)])
    }));
    return {
      id: header === null ? null : text(IDENTIFIER.exec(header[2]!)?.[1]),
      datestamp: header === null ? null : text(DATESTAMP.exec(header[2]!)?.[1]),
      deleted: header !== null && DELETED.test(header[1]!),
      controls: Object.fromEntries(controls),
      fields
    };
  });
}

export function readResumptionToken(xml: string): string | null {
  const token = text(RESUMPTION_TOKEN.exec(xml)?.[1]).trim();
  return token === "" ? null : token;
}

export function readOaiError(xml: string): string | null {
  const code = ERROR_CODE.exec(xml)?.[1];
  return code === undefined || code === NO_RECORDS ? null : structuredClone(code);
}

const clean = (value: string) => cleanCatalogText(value).replace(/\s+/g, " ").trim();

function raw(record: MarcRecord, tag: string, code: string): string[] {
  return record.fields.filter((f) => f.tag === tag).flatMap((f) => f.subfields.filter(([c]) => c === code).map(([, value]) => value));
}

function values(record: MarcRecord, tag: string, code: string): string[] {
  return raw(record, tag, code).map(clean).filter(Boolean);
}

function name(field: MarcField): string {
  return ["b", "a", "d"]
    .map((code) => clean(field.subfields.find(([c]) => c === code)?.[1] ?? ""))
    .filter(Boolean)
    .join(" ");
}

function names(record: MarcRecord, tag: string, role?: string): string[] {
  return record.fields
    .filter((f) => f.tag === tag && (role === undefined || f.subfields.some(([c, value]) => c === "4" && value === role)))
    .map(name)
    .filter(Boolean);
}

function pagesIn(extent: string | undefined): number | null {
  if (extent === undefined || !extent.includes("p.")) return null;
  const numbers = (extent.replace(/\[[^\]]*\]/g, "").match(/\d+/g) ?? []).map(Number);
  const pages = numbers.length === 0 ? 0 : Math.max(...numbers);
  return pages >= 1 && pages <= MAX_PAGES ? pages : null;
}

function yearOf(record: MarcRecord): number | null {
  const coded = raw(record, "100", "a")[0]?.slice(9, 13);
  if (coded !== undefined && CODED_YEAR.test(coded)) return Number(coded);
  const printed = YEAR_IN_TEXT.exec(values(record, "210", "d")[0] ?? "")?.[0];
  return printed === undefined ? null : Number(printed);
}

function publisherOf(record: MarcRecord): string | null {
  const publisher = clean((values(record, "210", "c")[0] ?? "").replace(/distrib\./gi, "").replace(/[[\]]/g, "")).replace(TRAILING_SEPARATORS, "");
  return NO_PUBLISHER.test(publisher) ? null : publisher;
}

function authorOf(record: MarcRecord): string {
  const named = [...names(record, "700"), ...names(record, "701")];
  if (named.length > 0) return named.join(", ");
  for (const role of AUTHOR_FALLBACKS) {
    const fallback = names(record, "702", role);
    if (fallback.length > 0) return fallback.join(", ");
  }
  return "";
}

function translatorOf(record: MarcRecord): string | null {
  const translators = names(record, "702", TRANSLATOR);
  if (translators.length < 2) return translators[0] ?? null;
  return `${translators.slice(0, -1).join(", ")} e ${translators.at(-1)}`;
}

export function mapBnpRecord(record: MarcRecord): BnpBook {
  const title = [values(record, "200", "a").join(" ; "), ...values(record, "200", "h"), ...values(record, "200", "i")].filter(Boolean).join(". ");
  const scan = values(record, "856", "u").map((value) => URL_IN_TEXT.exec(value)?.[0]).find((url) => url?.includes(SCAN) && URL.canParse(url));
  return {
    recordId: record.controls["001"] ?? null,
    isbns: [...new Set(values(record, "010", "a").filter(isValidIsbn).map(canonicalIsbn))],
    title: title.replace(LEADING_MARKERS, "$1 "),
    author: authorOf(record),
    translator: translatorOf(record),
    originalTitle: values(record, "304", "a").find((note) => ORIGINAL_TITLE.test(note))?.replace(ORIGINAL_TITLE, "") || null,
    publisher: publisherOf(record),
    year: yearOf(record),
    pages: pagesIn(values(record, "215", "a")[0]),
    languages: values(record, "101", "a"),
    udc: values(record, "675", "a"),
    summary: values(record, "330", "a")[0] ?? null,
    scanUrl: scan === undefined ? null : scan.replace(/^http:/i, "https:")
  };
}
