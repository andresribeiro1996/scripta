import type { DigestItem } from "@scripta/shared";

export function homeFeedSections(items: DigestItem[]) {
  const personal = items.filter((item) => item.kind === "participation" || item.kind === "follow" || item.kind === "completion");
  const following = items.filter((item) => item.kind !== "participation" && item.kind !== "follow" && item.kind !== "completion");
  return [...(personal.length ? [{ title: "Around your shelf", personal: true, data: personal }] : []), { title: "Your reading circle", personal: false, data: following }];
}

export function shouldMarkFeedSeen({ focused, rowVisible, loaded, failed, fetching, sent }: { focused: boolean; rowVisible: boolean; loaded: boolean; failed: boolean; fetching: boolean; sent: boolean }): boolean {
  return focused && rowVisible && loaded && !failed && !fetching && !sent;
}
