import { FontPicker } from "../components/FontPicker";
import { Page } from "../components/page/Page";
import { PANEL_HEADING } from "../components/page/surfaceClasses";
import { ThemePicker } from "../components/ThemePicker";
import { area } from "../lib/areas";

export function SettingsAppearancePage() {
  return (
    <Page title="Settings" tabs={area("settings").tabs} sideTabs>
      <section className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
        <h2 className={`${PANEL_HEADING} mb-4`}>Appearance</h2>
        <ThemePicker />
        <div className="mt-5 space-y-4">
          <FontPicker slot="display" />
          <FontPicker slot="text" />
        </div>
      </section>
    </Page>
  );
}
