import { createContext, useContext } from "react";
import type { Theme } from "./theme";

export const TabThemeContext = createContext<((theme: Theme | null) => void) | null>(null);

export function useSetTabTheme() {
  return useContext(TabThemeContext);
}
