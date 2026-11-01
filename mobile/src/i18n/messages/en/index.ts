import type { Messages } from "@scripta/shared/i18n";
import { addBook } from "./addBook";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { shell } from "./shell";

export const en = { ...addBook, ...errors, ...library, ...settings, ...shell } satisfies Messages;
export type MobileMessages = typeof en;
