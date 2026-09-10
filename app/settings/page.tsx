"use client";

import Link from "next/link";
import { createI18n, SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/client/i18n";
import { useViewerStore } from "@/components/viewer/store";

export default function SettingsPage() {
  const locale = useViewerStore((state) => state.locale);
  const setLocale = useViewerStore((state) => state.setLocale);
  const i18n = createI18n(locale);

  return (
    <main className="settings-page">
      <div className="settings-shell">
        <header>
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <small>OENG ISOXML STUDIO</small>
            <h1>{i18n.t("Viewer settings")}</h1>
          </div>
          <Link href="/">{i18n.t("Return to workspace")}</Link>
        </header>
        <section>
          <small>{i18n.t("Language").toUpperCase()}</small>
          <h2>{i18n.t("Choose interface language")}</h2>
          <p>{i18n.t("This preference is stored locally in your browser and applies across the viewer workspace.")}</p>
          <label>
            <span>{i18n.t("Language")}</span>
            <select
              value={locale}
              onChange={(event) =>
                setLocale(event.currentTarget.value as SupportedLocale)
              }
            >
              {SUPPORTED_LOCALES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>
        <section>
          <small>{i18n.t("Map providers").toUpperCase()}</small>
          <h2>{i18n.t("Network maps are opt-in")}</h2>
          <p>
            {i18n.t(
              "The workspace starts with no network base map. Enabling Streets or Satellite requests tiles from the provider named in the map attribution. Provider choice is stored as a browser-local preference; no access keys are stored.",
            )}
          </p>
        </section>
        <section>
          <small>{i18n.t("DDI dictionaries").toUpperCase()}</small>
          <h2>{i18n.t("Public metadata, separate standards text")}</h2>
          <p>
            {i18n.t(
              "The bundled public ISOBUS database snapshot supplies DDI names, units, ranges, device classes, and official links where available. Unknown identifiers remain selectable as raw DDIs. Licensed standards and schemas are not bundled.",
            )}
          </p>
        </section>
        <section>
          <small>{i18n.t("Privacy").toUpperCase()}</small>
          <h2>{i18n.t("Browser-local by default")}</h2>
          <p>
            {i18n.t(
              "ISOXML files are parsed in a dedicated browser worker. They are not uploaded, included in analytics, or used to resolve imported URLs.",
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
