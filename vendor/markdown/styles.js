// Markup-VISIBLE styling (owner directive 2026-06-18: "нехай форматування
// буде видиме — лише міняй візуально текст на жирний/курсив/закреслений;
// розмітку роби сірішою на блюр і яскравішою для частини у фокусі").
// Markers are NEVER hidden now: they stay GREY (dimmed) on blur and brighten
// to --fg when the cursor reveals their node. The per-type custom text
// styling (heading colour/underline, link colour/underline) is REMOVED — the
// visible markup carries the structure; only bold/italic/strikethrough change
// the text. Because the markers are always shown, nothing toggles glyph width
// ON reveal, so real font-weight bold is safe (monospace keeps a fixed advance
// anyway) and the zero-shift DoD — a reveal must move NO character — still
// holds. Markers always occupy their columns (Decoration.mark, no replace).

export const MARKDOWN_CSS = `
.cm-md-marker { color: var(--marker); opacity: 0.5 }
.cm-md-marker-revealed { color: var(--marker); opacity: 1 }
/* emphasis polish (owner 2026-06-19 "жирного більш насичений … покращ"):
   bold is heavier (monospace = fixed advance, so weight never shifts a glyph);
   italic carries a faint accent tint so it reads apart from plain text;
   inline code keeps its chip but gains a subtle code tint. */
.cm-md-bold { font-weight: 800 }
.cm-md-italic { font-style: italic; color: color-mix(in srgb, var(--fg) 82%, var(--accent)) }
.cm-md-code { background: var(--chip); border-radius: 0.2em;
  color: color-mix(in srgb, var(--fg) 80%, var(--muted)) }
/* headings: accent colour + per-level SIZE on the heading TEXT (owner
   2026-06-19: "before 0.75 headings/links had normal styles — regression
   again" — restore the colour the 0.74.0 markup-visible pass dropped, keep the
   markers visible). Colour + size are CONSTANT (not reveal-gated), so a reveal
   shifts no glyph. The # marker keeps body size; the text scales. */
.cm-md-h { font-weight: 700; color: var(--accent) }
.cm-md-h1 { font-size: 1.6em }
.cm-md-h2 { font-size: 1.4em }
.cm-md-h3 { font-size: 1.25em }
.cm-md-h4 { font-size: 1.1em }
.cm-md-h5 { font-size: 1em }
.cm-md-h6 { font-size: .9em; color: var(--muted) }
.cm-md-listmark { color: var(--accent) }
/* task checkbox widget: the outer span advances EXACTLY 3ch (the "[ ]" it
   replaces) — no padding/border/margin. It is 1em tall and vertical-align:
   middle so its centre lands on the text's OPTICAL middle (baseline + ½
   x-height), not the baseline (owner 2026-06-17: the box sat low). The visible
   box is absolute (zero advance impact), widened by negative inset for a
   finger target */
.cm-md-task { display: inline-block; width: 3ch; height: 1em; position: relative;
  vertical-align: middle; font: inherit; line-height: inherit;
  cursor: pointer }
.cm-md-task-box { position: absolute; inset: 0 -0.5rem; display: flex;
  align-items: center; justify-content: center }
.cm-md-task-box::before { content: ""; width: .9em; height: .9em;
  box-sizing: border-box; border: 1px solid var(--marker);
  border-radius: .15em }
.cm-md-task.checked .cm-md-task-box::before { background: var(--accent);
  border-color: var(--accent) }
.cm-md-task.checked .cm-md-task-box::after { content: ""; position: absolute;
  left: 50%; top: 50%; width: .25em; height: .5em;
  border: solid var(--bg); border-width: 0 .12em .12em 0;
  transform: translate(-50%, -62%) rotate(45deg) }
/* links: colour + underline restored (owner 2026-06-19: "before 0.75
   links had normal styles") — a local (in-project path) link colours apart
   from an external (scheme-bearing) one; the markers stay visible. Underline
   is metric-neutral, so a reveal still shifts no glyph. */
.cm-md-link { text-decoration: underline }
.cm-md-link-local { color: var(--accent) }
.cm-md-link-external { color: var(--info) }
/* a bare file path linkified in the render preview (chat: click → open the file).
   Coloured like a local link; colour-only hover keeps it off the GPU compositor. */
.aic-md-render .aic-md-path { color: var(--accent); text-decoration: underline; cursor: pointer }
.aic-md-render .aic-md-path:hover { color: var(--info) }
/* quote: muted italic with an accent rule (the > marker stays); strikethrough
   greys out (owner 2026-06-19 "перекреслений трохи сіруватий") */
.cm-md-quote { color: var(--muted); font-style: italic }
.cm-md-strike { text-decoration: line-through; color: var(--muted) }
.cm-md-hr { color: var(--marker) }
.cm-md-codeblock { background: color-mix(in srgb, var(--chip) 55%, transparent);
  color: color-mix(in srgb, var(--fg) 78%, var(--muted)) }
/* live table grid (owner 2026-06-19): the rendered block widget — the cursor
   entering the table reveals the raw pipes (edit line by line) */
.cm-md-table { padding: .3rem 0; overflow: hidden }
.cm-aic-table-scroll { box-sizing: border-box; width: 100%; max-width: 100%;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: thin;
  overscroll-behavior-x: contain; touch-action: pan-x pan-y }
.cm-md-table .cm-aic-table-scroll > table { width: max-content; min-width: 100%;
  border-collapse: collapse; table-layout: auto; font-family: monospace }
.cm-md-table th, .cm-md-table td { border: 1px solid var(--border);
  width: auto; max-width: min(32rem, 72vw); padding: .2rem .5rem;
  text-align: left; vertical-align: top; word-break: normal;
  overflow-wrap: normal; hyphens: none }
.cm-md-table thead th { background: var(--chip); font-weight: 700 }
.cm-md-table-link { color: var(--accent); text-decoration: underline; cursor: pointer }
.cm-aic-structure-cell { display: flex; align-items: center; gap: .2rem }
.cm-aic-cell-value { box-sizing: border-box; display: block; width: max-content;
  min-width: 5ch; max-width: min(32rem, 72vw); padding: .18rem .3rem;
  border: 1px solid transparent; border-radius: var(--radius); color: inherit;
  line-height: 1.4; white-space: pre-wrap; word-break: normal;
  overflow-wrap: normal; hyphens: none }
.cm-aic-cell-value[role="button"] { cursor: text }
.cm-aic-cell-value[role="button"]:hover,
.cm-aic-cell-value[role="button"]:focus-visible { border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent); outline: none }
.cm-aic-cell-value[data-empty="true"] { color: var(--muted); font-style: italic }
.cm-aic-cell-popover { position: fixed; z-index: 10000; box-sizing: border-box;
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .35rem;
  padding: .4rem; border: 1px solid var(--accent); border-radius: var(--radius);
  background: var(--bg); color: var(--fg); box-shadow: 0 .5rem 1.5rem #0006 }
.cm-aic-cell-editor { box-sizing: border-box; width: 100%; min-width: 0;
  min-height: 2rem; max-height: min(40vh, 18rem); padding: .35rem .45rem;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--input-bg, var(--bg)); color: inherit; font: inherit;
  line-height: 1.4; resize: vertical }
.cm-aic-cell-editor:focus { border-color: var(--accent); outline: none }
.cm-aic-cell-popover-actions { display: flex; align-items: flex-start; gap: .15rem }
.cm-aic-cell-popover-action { border: 1px solid var(--border);
  border-radius: var(--radius); background: transparent; color: var(--muted) }
.cm-aic-cell-popover-action:hover,
.cm-aic-cell-popover-action:focus-visible { border-color: var(--accent);
  color: var(--fg); outline: none }
.cm-aic-structure-handle-cell { width: 1.8rem; min-width: 1.8rem;
  padding: .1rem !important; text-align: center !important }
.cm-aic-drag-handle { width: 1.45rem; height: 1.45rem; padding: 0;
  border: 0; background: transparent; color: var(--muted); cursor: grab;
  font: inherit; line-height: 1 }
.cm-aic-drag-handle:active { cursor: grabbing }
.cm-aic-drag-handle:disabled { cursor: default; opacity: .35 }
.cm-md-block-preview:focus-within { border-color: var(--accent) !important }
/* props (frontmatter) table (owner 2026-07-01): the leading --- YAML block
   rendered as a read-only key/value grid — the cursor entering it reveals the
   raw YAML (edit line by line), the same reveal rule as the table widget */
.cm-md-props { padding: .3rem 0; overflow-x: auto }
.cm-md-props table { width: max-content; min-width: 100%; border-collapse: collapse;
  table-layout: auto; font-family: monospace }
.cm-md-props th, .cm-md-props td { border: 1px solid var(--border);
  padding: .2rem .5rem; vertical-align: top }
.cm-md-props th { background: var(--chip); color: var(--muted); font-weight: 700;
  text-align: right; white-space: nowrap }
.cm-md-props td { max-width: min(32rem, 72vw); color: var(--fg);
  text-align: left; white-space: normal; word-break: normal;
  overflow-wrap: normal; hyphens: none }
.cm-aic-property-key-cell { width: 1%; min-width: 8rem;
  max-width: min(20rem, 45vw); padding: .12rem .35rem !important }
.cm-aic-property-key { display: flex; align-items: center; gap: .2rem;
  padding-inline-start: calc(var(--aic-property-depth, 0) * .9rem) }
.cm-aic-property-level { width: .9rem; flex: 0 0 .9rem; color: var(--muted);
  text-align: center }
.cm-aic-property-item, .cm-aic-property-group { color: var(--muted);
  font-style: italic; font-weight: 400 }
.cm-md-mermaid { padding: .5rem 0; position: relative }
.cm-md-mermaid svg { max-width: 100% }
/* the mermaid preview rides the console Dialog SLOT now (owner 2026-06-24: "той
   самий діалог слот") — it FILLS the pane and centers the diagram; the svg scales
   to fit. (The old cursor-following float at a fixed 50vw is retired.) */
/* the slot now holds [builder toolbar][diagram]; top-align + stretch so the
   sticky toolbar pins to the top and spans full width (the diagram container
   centers the svg itself). */
.cm-md-mermaid-slot { padding: 0; overflow: auto;
  align-items: stretch; justify-content: flex-start }
.cm-md-mermaid-slot svg { max-width: 100%; height: auto }
.cm-md-mermaid-broken { display: inline-block; color: var(--warn);
  border: 1px dashed var(--border); border-radius: var(--radius);
  padding: .2rem .5rem; font-size: .85em }
.cm-md-mermaid-explain { white-space: pre-wrap; color: var(--fg);
  margin: .4rem 0 0 }
.cm-md-mermaid[role="button"] { cursor: pointer }
.cm-md-mermaid[role="button"]:focus-visible { outline: 1px solid var(--accent);
  outline-offset: -1px; border-radius: var(--radius) }
.cm-aic-link-control { display: inline-flex; align-items: center; gap: .25rem;
  max-width: 100%; vertical-align: baseline }
.cm-aic-link-open, .cm-aic-link-action { border: 0; background: transparent;
  color: inherit; font: inherit; cursor: pointer }
.cm-aic-link-open { min-width: 0; overflow: hidden; padding: 0;
  color: var(--accent); text-decoration: underline; text-overflow: ellipsis;
  white-space: nowrap }
.cm-aic-link-actions { display: inline-flex; gap: .15rem }
.cm-aic-link-action { padding: .05rem .28rem; border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--muted); font-size: .78em;
  text-decoration: none }
.cm-aic-link-action:hover, .cm-aic-link-action:focus-visible {
  color: var(--fg); border-color: var(--accent); outline: none }
.cm-aic-link-open:disabled, .cm-aic-link-action:disabled { cursor: default; opacity: .5 }
`;

export function injectStyles() {
  const style = document.createElement("style");
  style.dataset.aicModule = "markdown";
  style.textContent = MARKDOWN_CSS;
  document.head.appendChild(style);
  return { dispose: () => style.remove() };
}
