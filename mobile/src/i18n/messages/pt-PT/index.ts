import type { CatalogOf } from "@scripta/shared/i18n";
import type { en } from "../en";
import { addBook } from "./addBook";
import { arena } from "./arena";
import { book } from "./book";
import { community } from "./community";
import { errors } from "./errors";
import { library } from "./library";
import { quizzes } from "./quizzes";
import { settings } from "./settings";
import { sharing } from "./sharing";
import { shell } from "./shell";
import { tierlists } from "./tierlists";

export const ptPT: CatalogOf<typeof en> = { ...addBook, ...arena, ...book, ...community, ...errors, ...library, ...quizzes, ...settings, ...sharing, ...shell, ...tierlists };
