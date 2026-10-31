import type { CatalogOf } from "@scripta/shared/i18n";
import type { errors as en } from "../en/errors";

export const errors: CatalogOf<typeof en> = {
  "errors.tooManyTries": "Demasiadas tentativas. Aguarde {wait} e tente novamente.",
  "errors.waitSeconds": { one: "{count} segundo", other: "{count} segundos" },
  "errors.waitMinutes": { one: "{count} minuto", other: "{count} minutos" },
  "errors.waitHours": { one: "{count} hora", other: "{count} horas" },
  "errors.waitFallback": "um minuto",
};
