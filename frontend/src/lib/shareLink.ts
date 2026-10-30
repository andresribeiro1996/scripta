import type { ToastOptions } from "../components/Toaster";

export async function shareLink(title: string, url: string, toast: (options: ToastOptions) => void) {
  try {
    if (typeof navigator.share === "function") await navigator.share({ title, url });
    else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast({ message: "Link copied." });
    } else toast({ kind: "error", message: "Couldn't copy the link." });
  } catch (reason) {
    if (!(reason instanceof DOMException)) throw reason;
    if (reason.name !== "AbortError") toast({ kind: "error", message: "Couldn't share the link." });
  }
}
