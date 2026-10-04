import { applyLibraryChange, type LibraryChange } from "./libraryChange.js";
import type { LibraryData } from "./types.js";

const CHANGE_TIMEOUT_MS = 30_000;
const WHOLE_SAVE_TIMEOUT_MS = 60_000;

export interface LibraryDocument {
  data: LibraryData;
  updatedAt: string;
  shareToken: string | null;
  shareUrl: string | null;
}

export interface LibraryChangeAnswer {
  updatedAt: string;
  baseUpdatedAt: string | null;
}

export interface LibrarySaverDeps {
  send(change: LibraryChange, signal: AbortSignal): Promise<LibraryChangeAnswer>;
  put(data: LibraryData, expectedUpdatedAt: string | undefined, source: "import" | undefined, signal: AbortSignal): Promise<LibraryDocument>;
  fetch(signal?: AbortSignal): Promise<LibraryDocument | null>;
  write(view: LibraryDocument | null): void;
}

export interface LibrarySaveOptions {
  source?: "import";
  optimistic?: boolean;
}

export interface LibrarySaver {
  submit(change: LibraryChange): Promise<boolean>;
  saveWhole(updater: (data: LibraryData) => LibraryData, options?: LibrarySaveOptions): Promise<LibraryDocument>;
  merge(request: (expectedUpdatedAt: string | undefined, signal: AbortSignal) => Promise<LibraryDocument>): Promise<LibraryDocument>;
  receive(document: LibraryDocument): void;
  receiveShare(document: LibraryDocument): void;
  fetch(): Promise<LibraryDocument | null>;
  hasPending(): boolean;
  dispose(): void;
}

interface Entry {
  apply(data: LibraryData): LibraryData;
  savedAt?: string;
}

interface Job {
  run(): Promise<void>;
  drop(): void;
}

function isConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}

function disposedError(): Error {
  return new Error("The library was closed before this finished.");
}

export function createLibrarySaver(deps: LibrarySaverDeps): LibrarySaver {
  let confirmed: LibraryDocument | null = null;
  let view: LibraryDocument | null = null;
  let pending: Entry[] = [];
  let disposed = false;
  let interrupt: ((reason: Error) => void) | undefined;
  let running = false;
  const queue: Job[] = [];

  function show(next: LibraryDocument | null) {
    if (disposed) return;
    view = next;
    deps.write(next);
  }

  function withEntry(document: LibraryDocument | null, entry: Entry): LibraryDocument | null {
    const base = document?.data ?? { books: [] };
    const data = entry.apply(base);
    return data === base ? document : { updatedAt: "", shareToken: null, shareUrl: null, ...document, data };
  }

  function recompute() {
    show(pending.reduce(withEntry, confirmed));
  }

  function track(entry: Entry) {
    const next = withEntry(view, entry);
    pending.push(entry);
    show(next);
  }

  function release(entry: Entry) {
    pending = pending.filter((other) => other !== entry);
    recompute();
  }

  function markSaved(entry: Entry, updatedAt: string) {
    entry.savedAt = updatedAt;
    if (confirmed && confirmed.updatedAt >= updatedAt) release(entry);
  }

  function receive(document: LibraryDocument) {
    if (disposed || (confirmed && document.updatedAt <= confirmed.updatedAt)) return;
    confirmed = document;
    pending = pending.filter((entry) => entry.savedAt === undefined || entry.savedAt > document.updatedAt);
    recompute();
  }

  function receiveShare(document: LibraryDocument) {
    if (disposed) return;
    receive(document);
    if (confirmed && (confirmed.shareToken !== document.shareToken || confirmed.shareUrl !== document.shareUrl)) {
      const { shareToken, shareUrl } = document;
      confirmed = { ...confirmed, shareToken, shareUrl };
      show(view && { ...view, shareToken, shareUrl });
    }
  }

  function settle(entry: Entry, change: LibraryChange, answer: LibraryChangeAnswer): boolean {
    const base = confirmed;
    if (base && change.kind !== "add" && answer.baseUpdatedAt === base.updatedAt) {
      const applied = applyLibraryChange(base.data, change);
      if (!("error" in applied)) {
        confirmed = { ...base, data: applied.data, updatedAt: answer.updatedAt };
        pending = pending.filter((other) => other !== entry);
        show(view && { ...view, updatedAt: answer.updatedAt });
        return true;
      }
    }
    markSaved(entry, answer.updatedAt);
    return false;
  }

  async function call<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = reject;
      timer = setTimeout(() => reject(new Error("The server did not answer in time.")), ms);
    });
    try {
      return await Promise.race([run(controller.signal), interrupted]);
    } catch (error) {
      controller.abort();
      throw error;
    } finally {
      clearTimeout(timer);
      interrupt = undefined;
    }
  }

  async function refresh() {
    if (disposed) return;
    let fetched: LibraryDocument | null;
    try {
      fetched = await call(CHANGE_TIMEOUT_MS, (signal) => deps.fetch(signal));
    } catch {
      return;
    }
    if (fetched) receive(fetched);
  }

  async function putWhole(updater: (data: LibraryData) => LibraryData, source: "import" | undefined): Promise<LibraryDocument> {
    const attempt = () => {
      const base = confirmed;
      const data = base?.data ?? { books: [] };
      const next = updater(data);
      if (base && next === data) return Promise.resolve(base);
      return call(WHOLE_SAVE_TIMEOUT_MS, (signal) => deps.put(next, base?.updatedAt, source, signal));
    };
    try {
      return await attempt();
    } catch (error) {
      if (disposed || !isConflict(error)) throw error;
    }
    const fresh = await call(WHOLE_SAVE_TIMEOUT_MS, (signal) => deps.fetch(signal));
    if (disposed) throw disposedError();
    if (fresh) receive(fresh);
    return attempt();
  }

  async function pump() {
    running = true;
    try {
      for (let job = queue.shift(); job; job = queue.shift()) await job.run();
    } finally {
      running = false;
    }
  }

  function enqueue(job: Job) {
    queue.push(job);
    if (!running) void pump();
  }

  function submit(change: LibraryChange): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    const entry: Entry = {
      apply(data) {
        const applied = applyLibraryChange(data, change);
        return "error" in applied ? data : applied.data;
      }
    };
    track(entry);
    return new Promise<boolean>((resolve) => {
      enqueue({
        drop: () => resolve(false),
        async run() {
          let answer: LibraryChangeAnswer;
          try {
            answer = await call(CHANGE_TIMEOUT_MS, (signal) => deps.send(change, signal));
          } catch {
            release(entry);
            resolve(false);
            await refresh();
            return;
          }
          if (disposed) {
            resolve(false);
            return;
          }
          const folded = settle(entry, change, answer);
          resolve(true);
          if (!folded) await refresh();
        }
      });
    });
  }

  function saveWhole(updater: (data: LibraryData) => LibraryData, options: LibrarySaveOptions = {}): Promise<LibraryDocument> {
    if (disposed) return Promise.reject(disposedError());
    const entry: Entry | undefined = options.optimistic ? { apply: updater } : undefined;
    if (entry) track(entry);
    return new Promise<LibraryDocument>((resolve, reject) => {
      enqueue({
        drop: () => reject(disposedError()),
        async run() {
          let saved: LibraryDocument;
          try {
            saved = await putWhole(updater, options.source);
          } catch (error) {
            if (entry) release(entry);
            reject(error);
            if (entry) await refresh();
            return;
          }
          if (disposed) {
            reject(disposedError());
            return;
          }
          if (entry) markSaved(entry, saved.updatedAt);
          receive(saved);
          resolve(saved);
        }
      });
    });
  }

  function merge(request: (expectedUpdatedAt: string | undefined, signal: AbortSignal) => Promise<LibraryDocument>): Promise<LibraryDocument> {
    if (disposed) return Promise.reject(disposedError());
    return new Promise<LibraryDocument>((resolve, reject) => {
      enqueue({
        drop: () => reject(disposedError()),
        async run() {
          try {
            const document = await call(WHOLE_SAVE_TIMEOUT_MS, (signal) => request(confirmed?.updatedAt, signal));
            if (disposed) throw disposedError();
            receive(document);
            resolve(document);
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  }

  async function fetchView(): Promise<LibraryDocument | null> {
    if (disposed) return view;
    const fetched = await deps.fetch();
    if (fetched) receive(fetched);
    return view;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pending = [];
    interrupt?.(disposedError());
    for (const job of queue.splice(0)) job.drop();
  }

  return { submit, saveWhole, merge, receive, receiveShare, fetch: fetchView, hasPending: () => pending.length > 0, dispose };
}
