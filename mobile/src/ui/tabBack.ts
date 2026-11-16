export const HOME_TAB = "(home)";

export function backGoesHome(focusedTab: string, stackIndex: number) {
  return focusedTab !== HOME_TAB && stackIndex === 0;
}
