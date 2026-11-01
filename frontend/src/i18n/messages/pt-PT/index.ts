import type { CatalogOf } from "@scripta/shared/i18n";
import type { en } from "../en";
import { addBook } from "./addBook";
import { arena } from "./arena";
import { book } from "./book";
import { community } from "./community";
import { errors } from "./errors";
import { landing } from "./landing";
import { library } from "./library";
import { muralEditor } from "./muralEditor";
import { murals } from "./murals";
import { quizzes } from "./quizzes";
import { readerCard } from "./readerCard";
import { settings } from "./settings";
import { shell } from "./shell";
import { tierlists } from "./tierlists";

export const ptPT: CatalogOf<typeof en> = { ...addBook, ...arena, ...book, ...community, ...errors, ...landing, ...library, ...muralEditor, ...murals, ...quizzes, ...readerCard, ...settings, ...shell, ...tierlists };
