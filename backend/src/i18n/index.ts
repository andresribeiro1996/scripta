import { createTranslator, parseAcceptLanguage, resolveLocale, type Locale, type Translate, type Vars } from "@scripta/shared/i18n";
import type { FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import { en } from "./messages/en.js";
import { ptPT } from "./messages/pt-PT.js";

export type BackendKey = keyof typeof en;

const translators: Record<Locale, Translate<typeof en>> = { en: createTranslator(en), "pt-PT": createTranslator(ptPT) };

export function t(locale: Locale, key: BackendKey, vars?: Vars): string {
  return translators[locale](key, vars);
}

export function isBackendKey(value: string): value is BackendKey {
  return Object.hasOwn(en, value);
}

export function localeOf(request: FastifyRequest): Locale {
  return resolveLocale(null, parseAcceptLanguage(request.headers["accept-language"]));
}

export class LocalizedError extends Error {
  constructor(
    readonly key: BackendKey,
    readonly vars?: Vars
  ) {
    super(t("en", key, vars));
  }
}

export function validationMessage(locale: Locale, error: ZodError): string {
  const message = error.issues[0]?.message;
  if (message !== undefined && isBackendKey(message)) return t(locale, message);
  if (locale === "en") return message ?? t("en", "common.invalidRequest");
  return t(locale, "common.invalidRequest");
}
