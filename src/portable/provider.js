import { utf8Length, randomHex } from "../host-runtime.js";
/** The shared PWA owns cryptography. This adapter owns one encrypted TextDocument. */
import * as vscode from "vscode";
import { DisposableScope } from "../lifecycle.js";
import { assertWritableResource } from "../notes/resources.js";

const MAX_BYTES = 9 * 1024 * 1024;
const boundedText = (value) =>
  typeof value === "string" &&
  value.length <= MAX_BYTES &&
  utf8Length(value) <= MAX_BYTES;

function ciphertextTransport(value) {
  if (!boundedText(value)) return false;
  try {
    const envelope = JSON.parse(value);
    // This is a transport guard, not cryptographic validation. The exact shared
    // runtime validates the complete envelope and derives/decrypts the key.
    return (
      envelope?.format === "aic-browser-vault" &&
      envelope.version === 1 &&
      envelope.cipher?.name === "AES-GCM" &&
      typeof envelope.cipher.data === "string" &&
      envelope.cipher.data.length >= 24 &&
      /^[A-Za-z0-9+/]+={0,2}$/u.test(envelope.cipher.data)
    );
  } catch {
    return false;
  }
}

function attribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

export function portableHtml(webview, distRoot, html, api = vscode) {
  const nonce = randomHex(24);
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`;
  let result = html
    .replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/giu, "")
    .replace(/<link\b[^>]*rel="(?:manifest|apple-touch-icon)"[^>]*>/giu, "");
  result = result.replace(
    /(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"]+)(")/giu,
    (_match, start, resource, end) => {
      const path = resource.replace(/^\.\//u, "");
      if (
        !path ||
        path.startsWith("/") ||
        path
          .split("/")
          .some((part) => !part || part === ".." || part === ".") ||
        /[:\\?#]/u.test(path)
      ) {
        throw new Error(
          "The portable editor contains an unsafe resource path.",
        );
      }
      return `${start}${attribute(webview.asWebviewUri(api.Uri.joinPath(distRoot, ...path.split("/"))))}${end}`;
    },
  );
  result = result.replace(/<script\b/giu, `<script nonce="${nonce}"`);
  return result.replace(
    /<head>/iu,
    `<head><meta http-equiv="Content-Security-Policy" content="${attribute(policy)}">`,
  );
}

export class PortableEditorProvider {
  static register(context) {
    const provider = new PortableEditorProvider(context);
    provider.scope.add(
      vscode.window.registerCustomEditorProvider(
        "aicNotes.portable",
        provider,
        {
          webviewOptions: { retainContextWhenHidden: true },
          supportsMultipleEditorsPerDocument: false,
        },
      ),
    );
    return provider;
  }

  constructor(context, api = vscode) {
    this.context = context;
    this.api = api;
    this.scope = new DisposableScope();
  }

  dispose() {
    this.scope.dispose();
  }

  async resolveCustomTextEditor(document, panel) {
    if (this.scope.disposed) return;
    const scope = this.scope.child();
    const root = this.api.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "portable",
    );
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [root] };
    let ownText = null;
    let queue = Promise.resolve();
    const reply = async (requestId, result) => {
      if (!scope.disposed) await webview.postMessage({ requestId, ...result });
    };
    const process = async (message) => {
      if (scope.disposed || document.isClosed) return;
      if (
        !message ||
        typeof message !== "object" ||
        typeof message.requestId !== "string" ||
        !/^[A-Za-z0-9_-]{1,180}$/u.test(message.requestId)
      )
        return;
      if (message.type !== "portable.read" && message.type !== "portable.write")
        return;
      try {
        const current = document.getText();
        if (!boundedText(current))
          throw new Error(
            "The encrypted file exceeds the supported 9 MiB transport size.",
          );
        if (message.type === "portable.read") {
          await reply(message.requestId, { ok: true, text: current });
          return;
        }
        assertWritableResource(document.uri, this.api);
        if (
          !ciphertextTransport(message.text) ||
          (message.expected !== null && !boundedText(message.expected))
        ) {
          throw new Error("Only a supported encrypted AIC file can be saved.");
        }
        if (current !== (message.expected ?? "")) {
          throw new Error(
            "The encrypted file changed elsewhere. Reload it before saving your changes.",
          );
        }
        const requireExistingFile = async () => {
          if (document.isUntitled || document.uri.scheme === "untitled") return;
          try {
            await this.api.workspace.fs.stat(document.uri);
          } catch {
            throw new Error(
              "The encrypted file was deleted or is unavailable. Restore it before saving; your changes remain in the editor.",
            );
          }
        };
        await requireExistingFile();
        if (
          scope.disposed ||
          document.isClosed ||
          document.getText() !== current
        )
          throw new Error(
            "The encrypted file changed while saving. Reload it before retrying.",
          );
        const edit = new this.api.WorkspaceEdit();
        edit.replace(
          document.uri,
          new this.api.Range(
            document.positionAt(0),
            document.positionAt(current.length),
          ),
          message.text,
        );
        ownText = message.text;
        if (!(await this.api.workspace.applyEdit(edit)))
          throw new Error(
            "VS Code could not apply the encrypted file changes.",
          );
        if (
          scope.disposed ||
          document.isClosed ||
          document.getText() !== message.text
        ) {
          throw new Error(
            "The encrypted file changed while saving. Reload it before retrying.",
          );
        }
        await requireExistingFile();
        if (
          scope.disposed ||
          document.isClosed ||
          document.getText() !== message.text
        )
          throw new Error(
            "The encrypted file changed while saving. Reload it before retrying.",
          );
        if (!(await document.save()))
          throw new Error(
            "The encrypted file was not saved. Its encrypted changes remain in the VS Code document.",
          );
        if (
          scope.disposed ||
          document.isClosed ||
          document.getText() !== message.text
        ) {
          throw new Error(
            "The encrypted file changed while saving. Reload it before retrying.",
          );
        }
        await reply(message.requestId, { ok: true, text: message.text });
      } catch (error) {
        await reply(message.requestId, {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to save the encrypted file.",
        });
      } finally {
        ownText = null;
      }
    };
    scope.add(
      webview.onDidReceiveMessage((message) => {
        queue = queue.then(() => process(message)).catch(() => {});
        return queue;
      }),
    );
    scope.add(panel.onDidDispose(() => scope.dispose()));
    scope.add(
      this.api.workspace.onDidChangeTextDocument((event) => {
        if (
          scope.disposed ||
          event.document.uri.toString() !== document.uri.toString()
        )
          return;
        if (ownText !== null && event.document.getText() === ownText) return;
        void Promise.resolve(
          webview.postMessage({ type: "portable.changed" }),
        ).catch(() => {});
      }),
    );
    try {
      const bytes = await this.api.workspace.fs.readFile(
        this.api.Uri.joinPath(root, "index.html"),
      );
      if (!scope.disposed)
        webview.html = portableHtml(
          webview,
          root,
          new TextDecoder().decode(bytes),
          this.api,
        );
    } catch (error) {
      scope.dispose();
      throw error;
    }
  }
}
