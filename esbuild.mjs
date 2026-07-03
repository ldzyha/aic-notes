// Two bundles: the extension host (CJS, node) and the webview editor (ESM,
// browser, code-splitting so mermaid / @codemirror/lang-* land as lazy chunks
// loaded on first use — the same shape as aic's build).
import { build, context } from "esbuild";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");

const host = {
  entryPoints: ["src/extension.js"],
  // .cjs: package.json carries "type":"module" (ESM sources/tests), but the
  // extension host require()s the bundle — a .js would be misread as ESM
  outfile: "dist/extension.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  minify: true,
  logLevel: "info",
};

const webview = {
  entryPoints: ["src/webview/main.js"],
  outdir: "dist/webview",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  sourcemap: true,
  loader: { ".css": "text" },
  minify: true,
  logLevel: "info",
};

const jobs = [host];
if (existsSync(new URL("./src/webview/main.js", import.meta.url))) jobs.push(webview);

if (watch) {
  for (const job of jobs) (await context(job)).watch();
} else {
  await Promise.all(jobs.map((job) => build(job)));
}
