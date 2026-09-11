import * as vscode from "vscode";
import { StandardNotesAccount, AUTH_SECRET_KEY } from "./session.js";
import {
  StandardNotesAuthTransport,
  authDiagnostic,
} from "./standard-notes-transport.js";
import { createAuthOperationLock } from "./operation-lock.js";

const messages = {
  account_busy:
    "Another VS Code window is performing a Standard Notes account action. Finish or cancel it there, then retry here. No local session was deleted.",
  account_coordination_unavailable:
    "The local account-operation lock is unavailable. Retry after other account actions finish; authentication was stopped safely.",
  credentials_rejected:
    "Standard Notes rejected the credentials or session. Check your email and password, then sign in again.",
  mfa_required:
    "The two-factor code was not accepted. Start sign-in again with a current code.",
  security_key_required:
    "This account requires a security key. Security-key sign-in is not supported in this first auth-only version.",
  verification_required:
    "Standard Notes requires additional human verification. This first auth-only version cannot complete that challenge.",
  unsupported_protocol:
    "This version supports Standard Notes encryption protocol 004 only. No password was sent using an older protocol.",
  invalid_response:
    "The authentication response could not be validated. No notes were accessed.",
  network_error:
    "Cannot reach Standard Notes. Your saved session is kept; use Check Connection when online.",
  rate_limited: "Standard Notes asked to wait. Retry sign-in later.",
  server_error: "Standard Notes could not complete the request. Retry later.",
  secure_storage_unavailable:
    "VS Code secure storage is unavailable. Sign-in requires working SecretStorage; credentials will not be saved to files or settings.",
  invalid_saved_session:
    "The saved session could not be read. Sign out locally, then sign in again.",
  session_expired: "Your Standard Notes session has expired. Sign in again.",
  remote_logout_unconfirmed:
    "Signed out locally. The server could not confirm session revocation; revoke this AIC session in Standard Notes if needed.",
  invalid_input: "Enter your Standard Notes email and password.",
  authentication_failed:
    "Sign-in could not be completed. Retry; no notes were accessed.",
};

export function standardNotesAccountMessage(state) {
  const message = Object.hasOwn(messages, state?.issue ?? "")
    ? messages[state.issue]
    : messages.authentication_failed;
  const diagnostic = authDiagnostic({
    diagnostic: state?.diagnostic,
    status: state?.diagnostic?.status,
  });
  if (!diagnostic) return message;
  const code = [diagnostic.stage, diagnostic.reason].filter(Boolean).join("/");
  return `${message} [${code}${diagnostic.status ? `; HTTP ${diagnostic.status}` : ""}]`;
}

function prompt(options, signal) {
  const cancellation = new vscode.CancellationTokenSource();
  const cancel = () => cancellation.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  return vscode.window
    .showInputBox({ ignoreFocusOut: true, ...options }, cancellation.token)
    .finally(() => {
      signal?.removeEventListener("abort", cancel);
      cancellation.dispose();
    });
}

export function registerStandardNotesAuth(context) {
  const item = vscode.window.createStatusBarItem(
    "aicNotes.standardNotesAccount",
    vscode.StatusBarAlignment.Left,
    -50,
  );
  item.name = "Standard Notes account";
  item.command = "aicNotes.standardNotesAccount";
  const account = new StandardNotesAccount({
    secrets: context.secrets,
    transport: new StandardNotesAuthTransport(),
    acquireLock: createAuthOperationLock(context.globalStorageUri.fsPath),
    onChange: (state) => {
      const labels = {
        "signed-out": "$(account) SN: Sign in",
        "signing-in": "$(loading~spin) SN: Signing in",
        connected: "$(check) SN: Connected",
        checking: "$(loading~spin) SN: Checking",
        offline: "$(cloud-offline) SN: Offline",
        "reauth-required": "$(account) SN: Sign in again",
        "storage-unavailable": "$(warning) SN: Secure storage",
        "signing-out": "$(loading~spin) SN: Signing out",
      };
      item.text = labels[state.status];
      item.tooltip = [
        state.email,
        "Standard Notes · Authentication only. Note synchronization is not enabled.",
        state.issue ? standardNotesAccountMessage(state) : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      item.show();
    },
  });
  const announce = async () => {
    if (account.state.issue)
      await vscode.window.showWarningMessage(
        standardNotesAccountMessage(account.state),
      );
  };
  const signIn = async () => {
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showInformationMessage(
        "Trust this workspace before connecting your Standard Notes account.",
      );
      return;
    }
    await account.signIn(
      async (signal) => {
        const email = await prompt(
          {
            title: "Standard Notes · Sign in",
            prompt:
              "Email · authentication only; no notes will be imported or synced",
            placeHolder: "you@example.com",
            validateInput: (value) =>
              !value.trim() || value.length > 320
                ? "Enter your Standard Notes email."
                : undefined,
          },
          signal,
        );
        if (email === undefined) return;
        const password = await prompt(
          {
            title: "Standard Notes · Password",
            prompt:
              "Derived locally. Your account password is not sent to the server.",
            password: true,
            validateInput: (value) =>
              !value || value.length > 4096
                ? "Enter your password."
                : undefined,
          },
          signal,
        );
        if (password === undefined) return;
        return { email: email.trim(), password };
      },
      (retry, signal) =>
        prompt(
          {
            title: "Standard Notes · Two-factor code",
            prompt: retry
              ? "Previous code was rejected. Enter a current code."
              : "Enter the code from your authenticator.",
            password: true,
            validateInput: (value) =>
              /^\d{6}$/u.test(value.trim())
                ? undefined
                : "Enter the six-digit code.",
          },
          signal,
        ).then((value) => value?.trim()),
    );
    await announce();
    if (account.state.status === "connected")
      await vscode.window.showInformationMessage(
        "Standard Notes connected. Authentication only — note synchronization is not enabled yet.",
      );
  };
  const signOut = async () => {
    await account.signOut();
    await announce();
  };
  const check = async () => {
    if (!vscode.workspace.isTrusted) return;
    await account.check();
    await announce();
  };
  const menu = async () => {
    const state = account.state;
    const options = [
      ...(![
        "connected",
        "offline",
        "checking",
        "signing-in",
        "signing-out",
      ].includes(state.status)
        ? [{ label: "$(sign-in) Sign in to Standard Notes", action: signIn }]
        : []),
      ...(state.email &&
      !["checking", "signing-in", "signing-out"].includes(state.status)
        ? [{ label: "$(refresh) Check connection", action: check }]
        : []),
      ...(state.email || state.status !== "signed-out"
        ? [{ label: "$(sign-out) Sign out of Standard Notes", action: signOut }]
        : []),
    ];
    const choice = await vscode.window.showQuickPick(options, {
      title: state.email ? `Standard Notes · ${state.email}` : "Standard Notes",
      placeHolder: "Authentication only · note synchronization is not enabled",
    });
    await choice?.action();
  };
  context.subscriptions.push(
    item,
    { dispose: () => account.dispose() },
    vscode.commands.registerCommand("aicNotes.standardNotesAccount", menu),
    vscode.commands.registerCommand("aicNotes.signInStandardNotes", signIn),
    vscode.commands.registerCommand("aicNotes.signOutStandardNotes", signOut),
    vscode.commands.registerCommand(
      "aicNotes.checkStandardNotesConnection",
      check,
    ),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void account.restore();
    }),
    context.secrets?.onDidChange?.((event) => {
      if (event.key === AUTH_SECRET_KEY && vscode.workspace.isTrusted)
        void account.secretChanged();
    }) ?? { dispose() {} },
  );
  if (vscode.workspace.isTrusted) void account.restore();
  else account.publish("signed-out");
  return account;
}
