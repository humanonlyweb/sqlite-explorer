import { rmSync } from "node:fs";

import { rolldown, watch, type InputOptions, type OutputOptions } from "rolldown";

const production = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

if (!process.env.SQLITE_EXPLORER_PACKAGING) {
  rmSync("dist/better-sqlite3", { recursive: true, force: true });
}

const input: InputOptions = {
  input: "src/extension.ts",
  platform: "node",
  external: ["vscode", "better-sqlite3"],
};

const output: OutputOptions = {
  file: "dist/extension.js",
  format: "esm",
  sourcemap: !production,
  minify: production,
};

async function build(): Promise<void> {
  const bundle = await rolldown(input);
  await bundle.write(output);
  await bundle.close();
}

async function main(): Promise<void> {
  if (isWatch) {
    const watcher = watch({ ...input, output });
    watcher.on("event", (event) => {
      if (event.code === "BUNDLE_END") console.log("[rolldown] extension rebuilt");
      else if (event.code === "ERROR") console.error("[rolldown] error:", event.error);
    });
    console.log("[rolldown] watching extension…");
    return;
  }
  await build();
  console.log("[rolldown] extension build complete.");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
