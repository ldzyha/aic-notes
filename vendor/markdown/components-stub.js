// Minimal stand-in for aic's @aic/components kit — only what the vendored
// markdown files consume. Text glyphs instead of the kit's SVG icon set.

const GLYPHS = { external: "↗", edit: "✎", trash: "✕", warn: "⚠" };

export function Icon(name) {
  const span = document.createElement("span");
  span.className = "aicn-icon";
  span.textContent = GLYPHS[name] ?? "•";
  span.setAttribute("aria-hidden", "true");
  return span;
}

export function IconButton({ icon, label, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "aicn-iconbtn";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.append(Icon(icon), ` ${label}`);
  btn.onclick = onClick;
  return btn;
}
