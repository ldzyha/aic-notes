// Dark syntax highlighting for nested fenced-code (and raw markdown tokens
// the reveal-rule handlers don't own, e.g. a revealed link's URL). Replaces
// @codemirror/language's defaultHighlightStyle, which is designed for LIGHT
// backgrounds (its structure colors were unreadable on the dark palette and
// it underlined headings). VS Code Dark+-flavored colors; markdown STRUCTURE
// tags (heading/emphasis/strong/strikethrough) are deliberately absent —
// the cm-md-* handler classes own those.

import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "#C586C0" },
  { tag: [t.bool, t.null, t.atom, t.self], color: "#569CD6" },
  { tag: t.number, color: "#B5CEA8" },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: "#CE9178" },
  { tag: t.regexp, color: "#D16969" },
  { tag: t.comment, color: "#6A9955", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#DCDCAA" },
  { tag: [t.typeName, t.className, t.namespace], color: "#4EC9B0" },
  { tag: [t.variableName, t.definition(t.variableName), t.propertyName, t.attributeName], color: "#9CDCFE" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#D4D4D4" },
  { tag: t.tagName, color: "#569CD6" },
  { tag: t.escape, color: "#D7BA7D" },
  { tag: [t.meta, t.processingInstruction], color: "#8B949E" },
  { tag: [t.url, t.link], color: "#58A6FF" },
  { tag: t.invalid, color: "#F44747" },
]);
