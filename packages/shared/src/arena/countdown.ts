import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";

// Hours roll into days: a round that closes in a week read as "150h 8m
// left", which is arithmetic the reader has to finish themselves.
export function countdownLabel(closesAt: string, locale: Locale, now = Date.now()): string {
  const t = sharedT(locale);
  const remainingMs = new Date(closesAt).getTime() - now;
  if (remainingMs <= 0) return t("shared.countdown.closing");
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return t("shared.countdown.daysHours", { days, hours });
  return hours > 0 ? t("shared.countdown.hoursMinutes", { hours, minutes }) : minutes > 0 ? t("shared.countdown.minutesSeconds", { minutes, seconds }) : t("shared.countdown.seconds", { seconds });
}
