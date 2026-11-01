import type { ToastOptions } from "../components/Toaster";
import { t } from "../i18n";

export async function shareLink(title: string, url: string, toast: (options: ToastOptions) => void) {
  try {
    if (typeof navigator.share === "function") await navigator.share({ title, url });
    else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast({ message: t("addBook.linkCopied") });
    } else toast({ kind: "error", message: t("addBook.linkCopyFailed") });
  } catch (reason) {
    if (!(reason instanceof DOMException)) throw reason;
    if (reason.name !== "AbortError") toast({ kind: "error", message: t("addBook.linkShareFailed") });
  }
}
