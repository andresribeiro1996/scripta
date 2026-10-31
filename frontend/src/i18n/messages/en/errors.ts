import type { Messages } from "@scripta/shared/i18n";

export const errors = {
  "errors.tooManyTries": "Too many tries. Wait {wait} and try again.",
  "errors.waitSeconds": { one: "{count} second", other: "{count} seconds" },
  "errors.waitMinutes": { one: "{count} minute", other: "{count} minutes" },
  "errors.waitHours": { one: "{count} hour", other: "{count} hours" },
  "errors.waitFallback": "a minute",
} satisfies Messages;
