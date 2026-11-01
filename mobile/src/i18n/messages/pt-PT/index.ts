import type { CatalogOf } from "@scripta/shared/i18n";
import type { en } from "../en";
import { addBook } from "./addBook";
import { book } from "./book";
import { community } from "./community";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { sharing } from "./sharing";
import { shell } from "./shell";

export const ptPT: CatalogOf<typeof en> = { ...addBook, ...book, ...community, ...errors, ...library, ...settings, ...sharing, ...shell };
