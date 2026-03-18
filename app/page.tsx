import { CopyErrorButton } from "@/components/copy-error-button";
import { DashboardApp } from "@/components/dashboard-app";
import { getLiveSetupStatus } from "@/lib/config";
import { getDashboardSnapshot } from "@/lib/services/dashboard-service";

export const dynamic = "force-dynamic";

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "Unexpected dashboard error.";
  }
}

export default async function HomePage() {
  try {
    const snapshot = await getDashboardSnapshot();
    return <DashboardApp initialSnapshotJson={JSON.stringify(snapshot)} />;
  } catch (error) {
    const liveStatus = getLiveSetupStatus();
    const message = formatErrorMessage(error);

    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="setup-copy">
            <p className="eyebrow">Setup issue</p>
            <h1>Dashboard could not load.</h1>
            <p className="setup-lead">
              The app is reachable, but the initial catalog snapshot failed. Use the details below to fix the Google
              Sheets connection or Gemini setup, then refresh the page.
            </p>
          </div>

          <div className="setup-grid">
            <article className="setup-panel">
              <p className="eyebrow">Connection state</p>
              <ul className="setup-list">
                <li>Sheets configured: {liveStatus.sheetsConfigured ? "Yes" : "No"}</li>
                <li>Gemini configured: {liveStatus.geminiConfigured ? "Yes" : "No"}</li>
                <li>Catalog access: {liveStatus.catalogReadOnly ? "Read-only Google Sheets" : "Local mock catalog"}</li>
                <li>Activity storage: {liveStatus.activityStorage}</li>
                <li>Spreadsheet ID: {liveStatus.spreadsheetId || "Not set"}</li>
              </ul>
            </article>

            <article className="setup-panel">
              <p className="eyebrow">Mapped sheets</p>
              <ul className="setup-list">
                <li>Stones: {liveStatus.sheetNames.stones}</li>
                <li>Settings: {liveStatus.sheetNames.settings}</li>
                <li>Metal pricing: {liveStatus.sheetNames.metalPricing}</li>
                <li>Master Popisi: {liveStatus.sheetNames.masterPopisi}</li>
                <li>Inquiries: {liveStatus.sheetNames.inquiries}</li>
                <li>Valuations: {liveStatus.sheetNames.valuations}</li>
              </ul>
            </article>
          </div>

          {liveStatus.missingEnv.length ? (
            <article className="setup-panel">
              <p className="eyebrow">Missing env vars</p>
              <ul className="setup-list">
                {liveStatus.missingEnv.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}

          <div className="setup-error">
            <h2>Error message</h2>
            <pre>{message}</pre>
            <div className="setup-actions">
              <CopyErrorButton value={message} />
            </div>
          </div>
        </section>
      </main>
    );
  }
}
