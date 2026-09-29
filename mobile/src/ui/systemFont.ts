import { Platform } from "react-native";

export const SYSTEM_FAMILY = Platform.select({ ios: "System", default: "sans-serif" });
