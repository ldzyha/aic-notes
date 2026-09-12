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

export function showAuthInput(options, signal) {
  // A native button is an explicit submit path when Enter is intercepted by
  // the host or another extension. Both paths use the same local validation.
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return resolve(undefined);
    let input;
    let finished = false;
    const subscriptions = [];
    const cancel = () => finish(undefined);
    const finish = (value, error) => {
      if (finished) return;
      finished = true;
      const clean = (action) => {
        try {
          action();
        } catch (failure) {
          error ??= failure;
        }
      };
      clean(() => signal?.removeEventListener("abort", cancel));
      for (const subscription of subscriptions.splice(0))
        clean(() => subscription.dispose());
      if (input) {
        clean(() => {
          input.value = "";
        });
        clean(() => input.hide());
        clean(() => input.dispose());
      }
      if (error) reject(error);
      else resolve(value);
    };
    try {
      input = vscode.window.createInputBox();
      const { validateInput, ...properties } = options;
      Object.assign(input, { ignoreFocusOut: true, ...properties });
      const continueButton = {
        iconPath: new vscode.ThemeIcon("arrow-right"),
        tooltip: "Continue (Enter)",
      };
      input.buttons = [continueButton];
      // All three host-owned validators are synchronous and return an error
      // string or undefined. Never send a value until local validation passes.
      const validate = () => {
        const error = validateInput?.(input.value);
        input.validationMessage = error;
        return !error;
      };
      const accept = () => {
        if (finished) return;
        try {
          if (validate()) finish(input.value);
        } catch (error) {
          finish(undefined, error);
        }
      };
      subscriptions.push(input.onDidAccept(accept));
      subscriptions.push(
        input.onDidTriggerButton((button) => {
          if (button === continueButton) accept();
        }),
      );
      subscriptions.push(
        input.onDidChangeValue(() => {
          if (finished) return;
          try {
            validate();
          } catch (error) {
            finish(undefined, error);
          }
        }),
      );
      subscriptions.push(input.onDidHide(cancel));
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      else input.show();
    } catch (error) {
      finish(undefined, error);
    }
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
  let readiness = Promise.resolve();
  let entryRevision = 0;
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
    const revision = ++entryRevision;
    // Command activation can finish before SecretStorage restoration does.
    // Preserve this request instead of losing it to the account's busy guard.
    await readiness;
    if (
      revision !== entryRevision ||
      account.disposed ||
      !vscode.workspace.isTrusted
    )
      return;
    await account.signIn(
      async (signal) => {
        const email = await showAuthInput(
          {
            title: "Standard Notes · Sign in",
            prompt:
              "Email · press Enter or click → to continue. No notes will be synced.",
            step: 1,
            totalSteps: 2,
            placeholder: "you@example.com",
            validateInput: (value) =>
              !value.trim() || value.length > 320
                ? "Enter your Standard Notes email."
                : undefined,
          },
          signal,
        );
        if (email === undefined) return;
        const password = await showAuthInput(
          {
            title: "Standard Notes · Password",
            prompt:
              "Derived locally. Your account password is not sent to the server.",
            password: true,
            step: 2,
            totalSteps: 2,
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
        showAuthInput(
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
    entryRevision++;
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
      readiness = account.restore();
    }),
    context.secrets?.onDidChange?.((event) => {
      if (event.key === AUTH_SECRET_KEY && vscode.workspace.isTrusted)
        void account.secretChanged();
    }) ?? { dispose() {} },
  );
  if (vscode.workspace.isTrusted) readiness = account.restore();
  else account.publish("signed-out");
  return account;
}
