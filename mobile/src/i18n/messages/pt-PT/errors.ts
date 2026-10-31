import type { CatalogOf } from "@scripta/shared/i18n";
import type { errors as en } from "../en/errors";

export const errors: CatalogOf<typeof en> = {
  "errors.invalidResponse": "O servidor devolveu uma resposta inválida",
  "errors.requestFailed": "O pedido falhou ({status})",
  "errors.notSignedIn": "Sessão não iniciada",
};
