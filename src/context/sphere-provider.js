import * as vscode from "vscode";
import { ContextSphereGraph } from "./sphere-graph.js";
import { DisposableScope } from "../lifecycle.js";
import { webviewHtml } from "../editor/webview-html.js";

export const SPHERE_VIEW_ID = "aicNotes.contextSphere";

/** One host owner for the read-only graph and its replaceable webview. */
export class ContextSphereProvider {
  static register(context) {
    const provider = new ContextSphereProvider(context);
    provider.scope.add(
      vscode.window.registerWebviewViewProvider(SPHERE_VIEW_ID, provider),
    );
    context.subscriptions.push(provider);
    return provider;
  }

  constructor(context) {
    this.context = context;
    this.scope = new DisposableScope();
  }

  resolveWebviewView(view) {
    if (this.scope.disposed) return;
    this.surface?.dispose();
    const surface = this.scope.child();
    this.surface = surface;
    surface.defer(() => {
      if (this.surface === surface) this.surface = undefined;
    });
    let ready = false;
    const publish = (snapshot) => {
      if (!surface.disposed && ready)
        void Promise.resolve(
          view.webview.postMessage({ type: "graph", graph: snapshot }),
        ).catch(() => {});
    };
    const graph = surface.add(
      new ContextSphereGraph(vscode, {
        state: this.context.workspaceState,
        onUpdate: publish,
      }),
    );
    const dist = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
    );
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    surface.add(view.onDidDispose(() => surface.dispose()));
    surface.add(
      view.onDidChangeVisibility(() => {
        if (view.visible) publish(graph.snapshot);
      }),
    );
    surface.add(
      view.webview.onDidReceiveMessage(async (message) => {
        if (surface.disposed || !message || typeof message !== "object") return;
        if (message.type === "ready") {
          ready = true;
          publish(graph.snapshot);
          return;
        }
        if (typeof message.id !== "string" || message.id.length > 4096) return;
        // IDs are capabilities from the current graph, never arbitrary URI input.
        const uri = graph.resolve(message.id);
        if (!uri) return;
        try {
          if (message.type === "open")
            await vscode.commands.executeCommand("vscode.open", uri, {
              preview: false,
            });
          else if (
            message.type === "pin" &&
            typeof message.pinned === "boolean"
          )
            await graph.pin(message.id, message.pinned);
        } catch {
          if (!surface.disposed)
            void vscode.window.showWarningMessage(
              "AIC Notes: the context file is no longer available.",
            );
        }
      }),
    );
    view.webview.html = webviewHtml(
      view.webview,
      dist,
      "sphere.js",
      '<main id="sphere"></main>',
    );
    graph.start();
  }

  dispose() {
    this.scope.dispose();
    this.surface = undefined;
  }
}
