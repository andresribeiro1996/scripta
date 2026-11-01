import type { Messages } from "@scripta/shared/i18n";
import { addBook } from "./addBook";
import { arena } from "./arena";
import { book } from "./book";
import { community } from "./community";
import { errors } from "./errors";
import { library } from "./library";
import { murals } from "./murals";
import { quizzes } from "./quizzes";
import { readerCard } from "./readerCard";
import { settings } from "./settings";
import { sharing } from "./sharing";
import { shell } from "./shell";
import { tierlists } from "./tierlists";

export const en = { ...addBook, ...arena, ...book, ...community, ...errors, ...library, ...murals, ...quizzes, ...readerCard, ...settings, ...sharing, ...shell, ...tierlists } satisfies Messages;
export type MobileMessages = typeof en;
