# Expo agent skills

These skills are installed in `~/.codex/skills` and are available in Codex for Scripta mobile work. Codex selects them automatically when a request matches their description. Use `$skill-name` only to force a specific skill for a task.

## Skill map

| Skill | Where | When | How |
|---|---|---|---|
| `expo-web-to-native` | Migration closeout | After feature parity, before UI redesign | Audit route and behavior parity, leftover web assumptions, and screens that still feel like web. Do not restart the migration, introduce a DOM shell, or follow its EAS release step. |
| `expo-design-system` | `src/ui/theme.tsx`, `src/ui/components.tsx`, and screen styles | During the post-migration UI audit and whenever repeated visual drift appears | Extend the existing tokens and components. Never create a second theme or extract a component before it has proven reuse. |
| `expo-native-ui` | Screens and shared UI | When reviewing or implementing mobile layout, controls, safe areas, typography, icons, media, and platform behavior | Preserve Scripta's product identity while replacing web-like interaction patterns with native ones. Treat its sample styles as guidance, not a replacement theme. |
| `expo-ui` | Sheets, pickers, sliders, toggles, menus, and short grouped forms | When a native control could replace custom React Native UI | Check whether `@expo/ui` fits before adding another UI dependency. The skill is installed; the `@expo/ui` runtime package is not. Install it only for a chosen implementation with `npx expo install @expo/ui`. Keep `FlatList` for large collections. |
| `expo-router` | `src/app` routes and navigation shells | When changing routes, tabs, stacks, headers, links, modals, or form sheets | Follow the existing route adaptations in `README.md`; do not reorganize routes without a product or navigation need. |
| `expo-animation` | Gestures, transitions, press feedback, and haptics | When motion has a clear interaction purpose or when existing motion is janky | Prefer native navigation transitions or Reanimated/Gesture Handler already in the app. Support reduced motion and feel-check changes on a real device. Do not add decorative motion by default. |
| `expo-upgrade` | Expo and React Native dependencies and configuration | Only during an explicit Expo SDK upgrade or dependency-compatibility repair | Upgrade as an isolated task, use `npx expo install`, then run the mobile checks and `expo-doctor`. Do not mix an SDK upgrade with feature or UI work. |

## Recommended sequence

1. Finish functional migration and parity work.
2. Run `$expo-web-to-native` as a read-only closeout audit.
3. Run `$expo-design-system` to identify drift against the existing theme and components.
4. Review screens with `$expo-native-ui`; use `$expo-ui`, `$expo-router`, or `$expo-animation` only for the relevant layer.
5. Make and verify UI changes incrementally on a real device.

Explicit skill names are optional. Use them when the task spans several layers or when a specific audit is required, for example:

```text
$expo-web-to-native Audit the completed migration for remaining behavior gaps. Do not change files.
$expo-design-system Audit the mobile app for design-system drift. Extend the existing theme; do not create a new one.
$expo-native-ui Review the Library screen for mobile-native UX while preserving Scripta's visual identity.
```

## Project guardrails

- `AGENTS.md` and `mobile/AGENTS.md` override generic skill guidance.
- Normal development must use Expo Go or an existing development client. Do not run EAS build, submit, or update commands; do not create APK/AAB artifacts.
- Do not run `expo prebuild --clean` unless explicitly requested.
- Preserve intentional product interactions and freeform layouts; native does not mean replacing distinctive UI with generic platform UI.
- Reuse `src/ui/theme.tsx` and `src/ui/components.tsx`. Avoid broad style rewrites during functional migration.
- Keep Metro MCP output bounded with filters, summaries, and limits.

## Sources

- [Expo Skills](https://expo.dev/expo-skills)
- [Expo Native UI](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-native-ui/SKILL.md)
- [Expo Design System](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-design-system/SKILL.md)
- [Expo UI](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-ui/SKILL.md)
- [Expo Animation](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-animation/SKILL.md)
- [Expo Router](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-router/SKILL.md)
- [Expo Web to Native](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-web-to-native/SKILL.md)
- [Expo Upgrade](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-upgrade/SKILL.md)
