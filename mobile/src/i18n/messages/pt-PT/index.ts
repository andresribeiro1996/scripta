import type { CatalogOf } from "@scripta/shared/i18n";
import type { en } from "../en";
import { errors } from "./errors";
import { library } from "./library";
import { settings } from "./settings";
import { shell } from "./shell";

export const ptPT: CatalogOf<typeof en> = { ...errors, ...library, ...settings, ...shell };
