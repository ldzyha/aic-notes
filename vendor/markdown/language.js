// In-house LanguageSupport glue over @lezer/markdown (~20 lines) — the
// WORKLOG-recorded alternative to @codemirror/lang-markdown, which eagerly
// pulls lang-html/css/js (~190KB) and blows the 500KB initial budget.
// @lezer/markdown bundles INSIDE this module (rule 11: format parsers are
// not shared packages).

import { parser, GFM } from "@lezer/markdown";
import { Language, defineLanguageFacet } from "@codemirror/language";

const facet = defineLanguageFacet({});

export const markdownLanguage = new Language(
  facet,
  parser.configure([GFM]), // strikethrough, tables, task lists
  [],
  "markdown",
);
