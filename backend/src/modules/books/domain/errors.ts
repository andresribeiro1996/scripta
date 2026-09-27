export class SourceUnavailableError extends Error {
  constructor(readonly source: string, detail: string) {
    super(`${source} unavailable: ${detail}`);
    this.name = "SourceUnavailableError";
  }
}
