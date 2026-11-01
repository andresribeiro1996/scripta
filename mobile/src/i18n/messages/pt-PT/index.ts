import type { CatalogOf } from "@scripta/shared/i18n";
import type { en } from "../en";
import { addBook } from "./addBook";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { shell } from "./shell";

export const ptPT: CatalogOf<typeof en> = { ...addBook, ...errors, ...library, ...settings, ...shell };
