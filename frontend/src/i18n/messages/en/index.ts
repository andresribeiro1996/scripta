import type { Messages } from "@scripta/shared/i18n";
import { errors } from "./errors";
import { settings } from "./settings";

export const en = { ...errors, ...settings } satisfies Messages;
export type WebMessages = typeof en;
