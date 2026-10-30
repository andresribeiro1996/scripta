import { FontPicker } from "../components/FontPicker";
import { Page } from "../components/page/Page";
import { ThemePicker } from "../components/ThemePicker";
import { area } from "../lib/areas";

export function SettingsAppearancePage() {
  return (
    <Page title="Settings" tabs={area("settings").tabs} sideTabs>
      <section className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
        <h3 className="mb-4 text-sm font-semibold">Appearance</h3>
        <ThemePicker />
        <div className="mt-5 space-y-4">
          <FontPicker slot="display" />
          <FontPicker slot="text" />
        </div>
      </section>
    </Page>
  );
}
