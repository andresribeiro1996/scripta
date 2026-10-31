import type { CatalogOf } from "@scripta/shared/i18n";
import type { en } from "../en";
import { errors } from "./errors";
import { settings } from "./settings";

export const ptPT: CatalogOf<typeof en> = { ...errors, ...settings };
