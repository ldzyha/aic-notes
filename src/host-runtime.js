// Web-platform primitives shared by the desktop and browser extension hosts.
// Keep filesystem access in workspace.fs and document mutations in WorkspaceEdit.
export function utf8Length(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function randomHex(length = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
