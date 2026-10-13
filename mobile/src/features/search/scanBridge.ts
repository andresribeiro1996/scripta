let receiver: ((isbn: string) => void) | null = null;

export function receiveScans(next: (isbn: string) => void): () => void {
  receiver = next;
  return () => {
    if (receiver === next) receiver = null;
  };
}

export function sendScan(isbn: string): void {
  receiver?.(isbn);
}
