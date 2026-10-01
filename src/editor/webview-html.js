// Webview HTML scaffold. style-src needs 'unsafe-inline': CodeMirror and
// mermaid inject their style modules at runtime and the vendored aic CSS is
// inlined by the entry script (documented exception; script-src stays nonce +
// resource-origin for the lazy chunks).

import * as vscode from "vscode";
import { randomHex } from "../host-runtime.js";

export function nonce() {
  return randomHex(24);
}

export function webviewHtml(webview, distRoot, entry, body, bodyClass = "") {
  const n = nonce();
  const entryUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, entry));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${n}' ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body class="${bodyClass}">
${body}
<script type="module" nonce="${n}" src="${entryUri}"></script>
</body>
</html>`;
}
