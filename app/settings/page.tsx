import Link from "next/link";

export default function SettingsPage() {
  return (
    <main className="settings-page">
      <div className="settings-shell">
        <header>
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <small>OENG ISOXML STUDIO</small>
            <h1>Viewer settings</h1>
          </div>
          <Link href="/">Return to workspace</Link>
        </header>
        <section>
          <small>MAP PROVIDERS</small>
          <h2>Network maps are opt-in</h2>
          <p>
            The workspace starts with no network base map. Enabling Streets or
            Satellite requests tiles from the provider named in the map
            attribution. Provider choice is stored as a browser-local
            preference; no access keys are stored.
          </p>
        </section>
        <section>
          <small>DDI DICTIONARIES</small>
          <h2>Public metadata, separate standards text</h2>
          <p>
            The bundled public ISOBUS database snapshot supplies DDI names,
            units, ranges, device classes, and official links where available.
            Unknown identifiers remain selectable as raw DDIs. Licensed
            standards and schemas are not bundled.
          </p>
        </section>
        <section>
          <small>PRIVACY</small>
          <h2>Browser-local by default</h2>
          <p>
            ISOXML files are parsed in a dedicated browser worker. They are not
            uploaded, included in analytics, or used to resolve imported URLs.
          </p>
        </section>
      </div>
    </main>
  );
}
