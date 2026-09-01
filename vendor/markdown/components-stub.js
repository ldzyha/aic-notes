// Minimal stand-in for aic's @aic/components kit — only what the vendored
// markdown files consume. Text glyphs instead of the kit's SVG icon set.

const GLYPHS = { warn: "⚠" };

export function Icon(name) {
  const span = document.createElement("span");
  span.className = "aicn-icon";
  span.textContent = GLYPHS[name] ?? "•";
  span.setAttribute("aria-hidden", "true");
  return span;
}

// stand-in for aic's ErrorState card — used by the mermaid preview's "float"
// render context (the in-editor widget keeps its one-line marker instead)
export function ErrorCard({ error, detail, fix }) {
  const card = document.createElement("div");
  card.className = "aicn-error-card";
  const head = document.createElement("div");
  head.className = "aicn-error-head";
  head.append(Icon("warn"), ` ${error}`);
  const body = document.createElement("div");
  body.className = "aicn-error-detail";
  body.textContent = detail ?? "";
  card.append(head, body);
  for (const step of fix ?? []) {
    const line = document.createElement("div");
    line.className = "aicn-error-fix";
    line.textContent = `fix: ${step}`;
    card.append(line);
  }
  return card;
}
