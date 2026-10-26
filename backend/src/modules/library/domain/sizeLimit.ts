const BYTES_PER_MB = 1024 * 1024;

function wholeMegabytes(bytes: number): number {
  return Math.floor(bytes / BYTES_PER_MB);
}

export function libraryTooLargeMessage(maxBytes: number): string {
  return `Your library is over ${wholeMegabytes(maxBytes)} MB, the most Atmyshelf can store. Remove some books or highlights and try again.`;
}

export function importTooLargeMessage(maxBytes: number): string {
  return `This import is over ${wholeMegabytes(maxBytes)} MB, the most Atmyshelf can store. Import fewer books or highlights.`;
}
