export const DEVICE_SETUP_KEY = "streamlion-device-setup-v1";
export function deviceSetupChosen() {
  try {
    return localStorage.getItem(DEVICE_SETUP_KEY) === "device";
  } catch {
    return false;
  }
}
export function hasDeviceDrafts() {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      if (localStorage.key(index)?.startsWith("streamlion-draft-v1:"))
        return true;
    }
    return false;
  } catch {
    // Do not interrupt existing work when its optional storage cannot be read.
    return true;
  }
}
export default function WorkspaceSetup({ onGoogle, onDevice }) {
  return (
    <section
      className="workspace-setup"
      aria-labelledby="workspace-setup-title"
    >
      <header className="page-head">
        <div>
          <p className="setup-eyebrow">Welcome to your field workspace</p>
          <h1 id="workspace-setup-title">Set up StreamLion</h1>
          <p>Choose where your project records will live.</p>
        </div>
      </header>
      <div className="setup-choices">
        <section className="section-card">
          <h2>Use your Google account</h2>
          <p>
            Sign in with Google, then create or choose a workbook. Your projects
            and field files stay in your Google Sheets and Drive.
          </p>
          <button className="primary" onClick={onGoogle}>
            Set up with Google
          </button>
          <p className="hint">
            Use the same Google account on your other devices. No separate
            StreamLion password is needed.
          </p>
        </section>
        <section className="section-card">
          <h2>Try this device first</h2>
          <p>
            Create projects and field notes without signing in. This work stays
            in this browser and is not synced to Google.
          </p>
          <button onClick={onDevice}>Continue on this device</button>
          <p className="hint">
            Keep a device backup. Clearing browser data or ending private
            browsing can remove local work.
          </p>
        </section>
      </div>
      <p className="hint">
        You can connect Google later from Account. Installation is optional;
        open Install app above for your browser's options.
      </p>
    </section>
  );
}
