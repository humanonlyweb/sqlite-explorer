const STABLE_SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_PATH = "/humanonlyweb/sqlite-explorer/releases/";

export interface LatestRelease {
  version: string;
  url: string;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = STABLE_SEMVER.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;

  for (let i = 0; i < next.length; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i];
  }
  return false;
}

export function parseGitHubRelease(value: unknown): LatestRelease | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("tag_name" in value) || !("html_url" in value)) return null;
  if (typeof value.tag_name !== "string" || typeof value.html_url !== "string") return null;

  try {
    const url = new URL(value.html_url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith(RELEASE_PATH)
    ) {
      return null;
    }
    return { version: value.tag_name.replace(/^v/, ""), url: url.toString() };
  } catch {
    return null;
  }
}
