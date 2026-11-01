import type { Messages } from "@scripta/shared/i18n";
import { addBook } from "./addBook";
import { arena } from "./arena";
import { book } from "./book";
import { community } from "./community";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { shell } from "./shell";
import { tierlists } from "./tierlists";

export const en = { ...addBook, ...arena, ...book, ...community, ...errors, ...library, ...settings, ...shell, ...tierlists } satisfies Messages;
export type WebMessages = typeof en;
