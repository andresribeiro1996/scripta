import type { Messages } from "@scripta/shared/i18n";
import { addBook } from "./addBook";
import { arena } from "./arena";
import { book } from "./book";
import { community } from "./community";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { sharing } from "./sharing";
import { shell } from "./shell";

export const en = { ...addBook, ...arena, ...book, ...community, ...errors, ...library, ...settings, ...sharing, ...shell } satisfies Messages;
export type MobileMessages = typeof en;
