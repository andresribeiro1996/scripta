import type { Locale } from "@scripta/shared/i18n";
import { t } from "../../i18n/index.js";
import { renderEmail } from "../auth/index.js";

export const confirmationSubject = (locale: Locale): string => t(locale, "waitlist.subject");

export function confirmationEmail(email: string, siteUrl: string, locale: Locale): { text: string; html: string } {
  return renderEmail({
    heading: t(locale, "waitlist.heading"),
    paragraphs: [t(locale, "waitlist.thanks"), t(locale, "waitlist.body", { email })],
    footnote: t(locale, "waitlist.footnote")
  }, siteUrl, locale);
}
