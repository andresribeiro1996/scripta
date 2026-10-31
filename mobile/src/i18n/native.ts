import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, I18nManager } from "react-native";
import { parseLocalePreference } from "@scripta/shared/i18n";
import { getLocalePreference, setDeviceLocaleTags, setLocalePreference, subscribeLocale } from "./locale";

const STORAGE_KEY = "locale";

export function deviceLocaleTags(): string[] {
  const tag = Intl.DateTimeFormat().resolvedOptions().locale || I18nManager.getConstants().localeIdentifier;
  return tag ? [tag.replace(/_/g, "-")] : [];
}

let installing: Promise<void> | null = null;

async function install(): Promise<void> {
  try {
    setLocalePreference(parseLocalePreference(await AsyncStorage.getItem(STORAGE_KEY)));
  } catch (err) {
    console.warn("Couldn't read the saved language; following the device.", err);
  }
  setDeviceLocaleTags(deviceLocaleTags());
  let persisted = getLocalePreference();
  subscribeLocale(() => {
    const next = getLocalePreference();
    if (next === persisted) return;
    persisted = next;
    AsyncStorage.setItem(STORAGE_KEY, next).catch((err: unknown) => {
      console.warn("Couldn't save the language on this device.", err);
    });
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active") setDeviceLocaleTags(deviceLocaleTags());
  });
}

export function installNativeLocale(): Promise<void> {
  installing ??= install();
  return installing;
}
