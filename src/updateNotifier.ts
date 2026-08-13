import * as vscode from "vscode";

import { isNewerVersion, parseGitHubRelease } from "./version.ts";

const RELEASE_API = "https://api.github.com/repos/humanonlyweb/sqlite-explorer/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "releaseNotifier.lastCheck";
const NOTIFIED_VERSION_KEY = "releaseNotifier.notifiedVersion";

const VIEW_RELEASE = "View Release";
const DISABLE_CHECKS = "Disable Checks";

export async function checkForUpdates(context: vscode.ExtensionContext): Promise<void> {
  if (context.extensionMode !== vscode.ExtensionMode.Production) return;

  const configuration = vscode.workspace.getConfiguration("sqliteExplorer");
  if (!configuration.get<boolean>("checkForUpdates", true)) return;

  const now = Date.now();
  const lastCheck = context.globalState.get<number>(LAST_CHECK_KEY, 0);
  if (now - lastCheck < CHECK_INTERVAL_MS) return;

  // Cache before the request so an offline GitHub endpoint cannot cause a new
  // request each time another database activates the extension.
  await context.globalState.update(LAST_CHECK_KEY, now);

  try {
    const response = await fetch(RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "humanonlyweb-sqlite-explorer",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return;

    const release = parseGitHubRelease(await response.json());
    const currentVersion: unknown = context.extension.packageJSON.version;
    if (
      !release ||
      typeof currentVersion !== "string" ||
      !isNewerVersion(release.version, currentVersion) ||
      context.globalState.get<string>(NOTIFIED_VERSION_KEY) === release.version
    ) {
      return;
    }

    // One notification per release. Ignoring it does not make it reappear the
    // next day; a later release can still notify normally.
    await context.globalState.update(NOTIFIED_VERSION_KEY, release.version);
    const action = await vscode.window.showInformationMessage(
      `SQLite Explorer ${release.version} is available.`,
      VIEW_RELEASE,
      DISABLE_CHECKS,
    );

    if (action === VIEW_RELEASE) {
      await vscode.env.openExternal(vscode.Uri.parse(release.url));
    } else if (action === DISABLE_CHECKS) {
      await configuration.update("checkForUpdates", false, vscode.ConfigurationTarget.Global);
    }
  } catch {
    // Update checks must never interfere with opening a database.
  }
}
