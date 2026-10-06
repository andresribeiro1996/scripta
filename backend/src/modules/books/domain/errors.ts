export interface SourceErrorOptions {
  status?: number;
  retryAt?: number;
  quota?: boolean;
}

export class SourceUnavailableError extends Error {
  readonly status?: number;
  readonly retryAt?: number;
  readonly quota?: boolean;

  constructor(readonly source: string, detail: string, options: SourceErrorOptions = {}) {
    super(`${source} unavailable: ${detail}`);
    this.name = "SourceUnavailableError";
    this.status = options.status;
    this.retryAt = options.retryAt;
    this.quota = options.quota;
  }
}

export class SourcePausedError extends SourceUnavailableError {
  declare readonly retryAt: number;

  constructor(source: string, detail: string, options: { retryAt: number }) {
    super(source, detail, options);
    this.name = "SourcePausedError";
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

export class WorkMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkMergeError";
  }
}
