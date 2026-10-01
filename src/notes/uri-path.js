// URI paths are POSIX paths on every platform, including Windows desktop.
// This module never translates a URI into a local machine filesystem path.
export const isAbsolute = (value) => value.startsWith("/");
export function normalize(value) {
  const absolute = isAbsolute(value);
  const parts = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts.at(-1) !== "..") parts.pop();
      else if (!absolute) parts.push(part);
    } else parts.push(part);
  }
  const result = `${absolute ? "/" : ""}${parts.join("/")}` || ".";
  return value.endsWith("/") && result !== "/" ? `${result}/` : result;
}
export function basename(value) {
  return value.replace(/\/+$/u, "").split("/").at(-1) ?? "";
}
export function dirname(value) {
  const trimmed = value.replace(/\/+$/u, "");
  const end = trimmed.lastIndexOf("/");
  return end < 0
    ? value.startsWith("/")
      ? "/"
      : "."
    : end === 0
      ? "/"
      : trimmed.slice(0, end);
}
export const posix = { isAbsolute, normalize, basename, dirname };
