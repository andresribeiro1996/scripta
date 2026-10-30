export function shouldMarkFeedSeen({ focused, rowVisible, loaded, failed, fetching, sent }: { focused: boolean; rowVisible: boolean; loaded: boolean; failed: boolean; fetching: boolean; sent: boolean }): boolean {
  return focused && rowVisible && loaded && !failed && !fetching && !sent;
}
