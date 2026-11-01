import type { Messages } from "@scripta/shared/i18n";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { shell } from "./shell";

export const en = { ...errors, ...library, ...settings, ...shell } satisfies Messages;
export type WebMessages = typeof en;
