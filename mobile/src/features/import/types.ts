import type { LibraryData } from "@scripta/shared";
import type { File } from "expo-file-system";

export type ImportFilePicker = () => Promise<File | null>;

export interface ImportPreview {
  data: LibraryData;
  warnings: string[];
}
