// Nested fenced-code highlighting — the architecture of aic's fenced.js
// (synchronous codeParser + cache + onLoad reconfigure) with the host-service
// resolver replaced by static lazy imports of @codemirror/lang-* packages;
// esbuild code-splitting turns each into a chunk loaded on the first fence of
// that language. Mermaid is excluded (its own widget path).

import { parser, GFM, parseCode } from "@lezer/markdown";
import { Language, defineLanguageFacet } from "@codemirror/language";

const LOADERS = {
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascriptLanguage.parser),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.jsxLanguage.parser),
  javascript: () => import("@codemirror/lang-javascript").then((m) => m.javascriptLanguage.parser),
  ts: () => import("@codemirror/lang-javascript").then((m) => m.typescriptLanguage.parser),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.tsxLanguage.parser),
  typescript: () => import("@codemirror/lang-javascript").then((m) => m.typescriptLanguage.parser),
  py: () => import("@codemirror/lang-python").then((m) => m.pythonLanguage.parser),
  python: () => import("@codemirror/lang-python").then((m) => m.pythonLanguage.parser),
  rs: () => import("@codemirror/lang-rust").then((m) => m.rustLanguage.parser),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rustLanguage.parser),
  css: () => import("@codemirror/lang-css").then((m) => m.cssLanguage.parser),
  json: () => import("@codemirror/lang-json").then((m) => m.jsonLanguage.parser),
  html: () => import("@codemirror/lang-html").then((m) => m.htmlLanguage.parser),
  htm: () => import("@codemirror/lang-html").then((m) => m.htmlLanguage.parser),
  xml: () => import("@codemirror/lang-html").then((m) => m.htmlLanguage.parser),
};

const facet = defineLanguageFacet({});

// a chunk that fails to load is recorded with this sentinel — distinct from
// the `null` in-flight marker — so a permanently-broken chunk is reported
// ONCE and not re-imported on every later fence.
const FENCE_FAILED = Symbol("fence-failed");

export function makeFencedMarkdown({ cache, onLoad, onError }) {
  const codeParser = (info) => {
    const lang = (info.trim().split(/\s+/)[0] || "").toLowerCase();
    if (!lang || lang === "mermaid" || !(lang in LOADERS)) return null;
    if (cache.has(lang)) {
      const c = cache.get(lang); // null = in-flight, FENCE_FAILED = gave up
      return c && c !== FENCE_FAILED ? c : null;
    }
    cache.set(lang, null); // mark in-flight (don't resolve twice)
    LOADERS[lang]()
      .then((p) => {
        cache.set(lang, p);
        onLoad();
      })
      .catch((e) => {
        cache.set(lang, FENCE_FAILED);
        onError?.({
          error: "fence_parser_load_failed",
          detail: `the ${lang} fenced-code parser chunk failed to load: ${e}`,
          fix: ["Rebuild the extension: npm run build", "then reload the window"],
        });
      });
    return null;
  };
  return new Language(facet, parser.configure([GFM, parseCode({ codeParser })]), [], "markdown");
}
