// Haptics are a courtesy, never the feedback itself: every call here is paired
// with a visual change at the same moment, and every one is allowed to fail —
// the API rejects on hardware without a taptic engine, and a rejected promise
// must not take a gesture down with it.
import * as Haptics from "expo-haptics";

function safely(run: () => Promise<void>) {
  try {
    void run().catch(() => {});
  } catch {
    // Older Androids throw synchronously rather than rejecting.
  }
}

/** A long press has armed and the item is now draggable. */
export function liftHaptic() {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** A drag ended somewhere that actually changed the order. */
export function commitHaptic() {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** An operation the user asked for finished. */
export function successHaptic() {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** An operation the user asked for failed. */
export function errorHaptic() {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
