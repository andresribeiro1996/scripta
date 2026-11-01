import { FontPicker } from "../components/FontPicker";
import { Page, SettingGroup } from "../components/page/Page";
import { PANEL } from "../components/page/surfaceClasses";
import { LanguagePicker } from "../components/LanguagePicker";
import { ThemePicker } from "../components/ThemePicker";
import { area } from "../lib/areas";
import { useT } from "../i18n";

export function SettingsAppearancePage() {
  const t = useT();
  return (
    <Page title={t("shell.areaSettings")} tabs={area("settings").tabs} sideTabs>
      <SettingGroup title={t("shell.tabAppearance")}>
        <div className={`${PANEL} p-5`}>
          <ThemePicker />
          <div className="mt-5 space-y-4">
            <FontPicker slot="display" />
            <FontPicker slot="text" />
            <LanguagePicker />
          </div>
        </div>
      </SettingGroup>
    </Page>
  );
}
