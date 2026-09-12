// Nested fenced-code highlighting — the architecture of aic's fenced.js
// (synchronous codeParser + cache + onLoad reconfigure) with the host-service
// resolver replaced by static lazy imports of @codemirror/lang-* packages;
// esbuild code-splitting turns each into a chunk loaded on the first fence of
// that language. Mermaid is excluded (its own widget path).

import { parser, GFM, parseCode } from "@lezer/markdown";
import { Language, defineLanguageFacet } from "@codemirror/language";

import { codeLanguageFor } from "../../vendor/aic-editor-core/code-languages.js";

const facet = defineLanguageFacet({});

// a chunk that fails to load is recorded with this sentinel — distinct from
// the `null` in-flight marker — so a permanently-broken chunk is reported
// ONCE and not re-imported on every later fence.
const FENCE_FAILED = Symbol("fence-failed");

export function makeFencedMarkdown({ cache, onLoad, onError }) {
  const codeParser = (info) => {
    const lang = (info.trim().split(/\s+/)[0] || "").toLowerCase();
    const language = codeLanguageFor(lang);
    if (!language) return null;
    if (cache.has(lang)) {
      const c = cache.get(lang); // null = in-flight, FENCE_FAILED = gave up
      return c && c !== FENCE_FAILED ? c : null;
    }
    cache.set(lang, null); // mark in-flight (don't resolve twice)
    language
      .load()
      .then((support) => {
        cache.set(lang, support.language.parser);
        onLoad();
      })
      .catch((e) => {
        cache.set(lang, FENCE_FAILED);
        onError?.({
          error: "fence_parser_load_failed",
          detail: `the ${lang} fenced-code parser chunk failed to load: ${e}`,
          fix: [
            "Rebuild the extension: npm run build",
            "then reload the window",
          ],
        });
      });
    return null;
  };
  return new Language(
    facet,
    parser.configure([GFM, parseCode({ codeParser })]),
    [],
    "markdown",
  );
}
