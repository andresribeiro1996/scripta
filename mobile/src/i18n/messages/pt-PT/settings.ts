import type { CatalogOf } from "@scripta/shared/i18n";
import type { settings as en } from "../en/settings";

export const settings: CatalogOf<typeof en> = {
  "settings.language": "Idioma",
  "settings.languageAuto": "Automático (idioma do dispositivo)",
  "settings.languageSaveFailed": "Não foi possível guardar na sua conta. Tente novamente.",
  "settings.theme": "Tema",
  "settings.themeSystem": "Sistema",
  "settings.fontDefault": "Predefinido",
  "settings.fontThemeDefault": "Predefinido do tema · {font}",
  "settings.headings": "Títulos",
  "settings.text": "Texto",
  "settings.headingFont": "Tipo de letra dos títulos",
  "settings.textFont": "Tipo de letra do texto",
};
