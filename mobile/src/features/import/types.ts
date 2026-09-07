import type { LibraryData } from "@scripta/shared";

export interface ImportFile {
  uri: string;
  name: string;
  mimeType?: string;
}

export type ImportFilePicker = () => Promise<ImportFile | null>;

export interface ImportPreview {
  data: LibraryData;
  warnings: string[];
}
