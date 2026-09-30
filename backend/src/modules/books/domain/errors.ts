export class SourceUnavailableError extends Error {
  constructor(readonly source: string, detail: string) {
    super(`${source} unavailable: ${detail}`);
    this.name = "SourceUnavailableError";
  }
}

export class BookNotFoundError extends Error {
  constructor() {
    super("No such book.");
    this.name = "BookNotFoundError";
  }
}

export class FileTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    this.name = "FileTooLargeError";
  }
}

export class InvalidImageError extends Error {
  constructor() {
    super("That file isn't an image we can use.");
    this.name = "InvalidImageError";
  }
}
