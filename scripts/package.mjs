// Builds a platform-specific .vsix for each VS Code target.
//
// better-sqlite3 ships N-API prebuilds for every platform (ABI-stable across
// Node and Electron), so nothing is compiled here. Because vsce runs with
// --no-dependencies (the only mode compatible with a bun-managed node_modules)
// it won't ship node_modules at all, so we vendor the module's runtime — the JS
// wrapper plus the ONE matching prebuild — into dist/, which vsce always
// packages. Every target is therefore buildable from a single machine.
//
// Usage:
//   node scripts/package.mjs                 # all targets
//   node scripts/package.mjs darwin-arm64    # one or more specific targets
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// vsce --target  ->  better-sqlite3 prebuild basename (in node_modules/better-sqlite3/prebuilds)
const TARGETS = {
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "win32-x64",
  "win32-arm64": "win32-arm64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "alpine-x64": "linuxmusl-x64",
  "alpine-arm64": "linuxmusl-arm64",
};

const SRC = "node_modules/better-sqlite3";
const VENDOR = "dist/better-sqlite3";
const OUT = "release";

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : Object.keys(TARGETS);

const unknown = targets.filter((t) => !(t in TARGETS));
if (unknown.length > 0) {
  console.error(`Unknown target(s): ${unknown.join(", ")}`);
  console.error(`Known targets: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

// Vendor the JS wrapper + a single prebuild. vsce's `vscode:prepublish` rebuilds
// dist/extension.js and dist/webview but never touches dist/better-sqlite3, so
// vendoring right before packaging is safe.
function vendor(prebuild) {
  rmSync(VENDOR, { recursive: true, force: true });
  cpSync(join(SRC, "package.json"), join(VENDOR, "package.json"));
  cpSync(join(SRC, "lib"), join(VENDOR, "lib"), { recursive: true });
  mkdirSync(join(VENDOR, "prebuilds"), { recursive: true });
  cpSync(join(SRC, "prebuilds", `${prebuild}.node`), join(VENDOR, "prebuilds", `${prebuild}.node`));
}

mkdirSync(OUT, { recursive: true });

try {
  for (const target of targets) {
    const prebuild = TARGETS[target];
    console.log(`\n▶  ${target}  (prebuilds/${prebuild}.node)`);
    vendor(prebuild);
    execSync(`bunx @vscode/vsce package --no-dependencies --target ${target} -o ${OUT}/`, {
      stdio: "inherit",
      env: { ...process.env, SQLITE_EXPLORER_PACKAGING: "1" },
    });
  }
} finally {
  rmSync(VENDOR, { recursive: true, force: true });
}

console.log(`\n✔  VSIX packages written to ${OUT}/`);
