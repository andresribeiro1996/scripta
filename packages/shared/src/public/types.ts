export interface PublicBookData {
  key: string;
  workId: string | null;
  title: string;
  author: string;
  isbn: string | null;
  imageId: string | null;
  coverUrl: string | null;
  readStatus: number | null;
}

export interface PublicHighlight {
  bookKey: string;
  highlightId: string;
  text: string;
  annotation: string | null;
}
