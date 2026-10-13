/** Parse only a valid inclusive #Lx or #Lx-Ly range. */
export function sourceLocationFromHref(value) {
  const href = String(value ?? "").trim();
  const hashAt = href.indexOf("#");
  const queryAt = href.indexOf("?");
  const pathEnd = [hashAt, queryAt]
    .filter((index) => index >= 0)
    .reduce((left, right) => Math.min(left, right), href.length);
  const encodedPath = href.slice(0, pathEnd);
  let path = encodedPath;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    // Keep the original path; the caller will fail safely if it does not exist.
  }
  const fragment = hashAt >= 0 ? href.slice(hashAt + 1).split("?", 1)[0] : "";
  const match = /^L([1-9]\d*)(?:-L?([1-9]\d*))?$/iu.exec(fragment);
  if (!match) return { path, line: null, endLine: null };
  const line = Number(match[1]);
  const endLine = match[2] ? Number(match[2]) : line;
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(endLine) ||
    endLine < line
  ) {
    return { path, line: null, endLine: null };
  }
  return { path, line, endLine };
}
