// Two bundles: the extension host (CJS, node) and the webview editor (ESM,
// browser, code-splitting so mermaid / @codemirror/lang-* land as lazy chunks
// loaded on first use — the same shape as aic's build).
import { build, context } from "esbuild";
import { existsSync, cpSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPortableSnapshot } from "./scripts/verify-portable-runtime.mjs";

const watch = process.argv.includes("--watch");
const distRoot = new URL("./dist/", import.meta.url);

const portableSource = process.env.AIC_PORTABLE_SOURCE
  ? resolve(process.env.AIC_PORTABLE_SOURCE)
  : fileURLToPath(new URL("./vendor/portable-runtime/", import.meta.url));
await verifyPortableSnapshot(fileURLToPath(new URL("./", import.meta.url)), {
  directory: portableSource,
});
const portableEntry = resolve(portableSource, "index.html");
if (
  !existsSync(portableEntry) ||
  !existsSync(resolve(portableSource, "assets"))
) {
  throw new Error(
    "Synchronize the canonical PWA build and PORTABLE_SNAPSHOT.json before building AIC Notes.",
  );
}
const portableHtml = readFileSync(portableEntry, "utf8");
if (!/<script\b[^>]*type="module"[^>]*src="\.\/assets\//u.test(portableHtml)) {
  throw new Error(
    "The canonical portable editor build has no local module entry.",
  );
}

// dist is entirely generated. Clearing it prevents content-hashed lazy
// chunks from earlier builds leaking into a later VSIX.
rmSync(distRoot, { recursive: true, force: true });
cpSync(portableSource, new URL("./dist/portable/", import.meta.url), {
  recursive: true,
});

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
  sourcemap: false,
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
  sourcemap: false,
  loader: { ".css": "text" },
  minify: true,
  logLevel: "info",
};

const jobs = [host];
if (existsSync(new URL("./src/webview/main.js", import.meta.url)))
  jobs.push(webview);

// bundled JetBrains Mono (OFL) — plain static assets, no loader involved;
// main.js builds the @font-face URLs against its own import.meta.url
cpSync(
  new URL("./src/webview/fonts", import.meta.url),
  new URL("./dist/webview/fonts", import.meta.url),
  { recursive: true },
);

if (watch) {
  for (const job of jobs) (await context(job)).watch();
} else {
  await Promise.all(jobs.map((job) => build(job)));
}
