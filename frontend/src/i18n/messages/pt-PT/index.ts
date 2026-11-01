import type { CatalogOf } from "@scripta/shared/i18n";
import type { en } from "../en";
import { addBook } from "./addBook";
import { arena } from "./arena";
import { book } from "./book";
import { community } from "./community";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { shell } from "./shell";

export const ptPT: CatalogOf<typeof en> = { ...addBook, ...arena, ...book, ...community, ...errors, ...library, ...settings, ...shell };
