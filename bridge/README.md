# AIC Notes Standard Notes bridge

This bridge core handles Standard Notes authentication, encryption, item sync, and tag references.
Linux packages run it as a native helper; Windows packages run the same Go core as in-process
WebAssembly so Smart App Control never has to launch an unsigned executable. It uses the pinned MIT
`gosn-v2` module in `go.mod` directly.

Protocol: one JSON object on stdin and one JSON object on stdout. Supported operations are
`status`, `connect`, `disconnect`, `pull-project`, `sync`, and `trash`. Input is limited to 2 MiB. The VS Code host additionally limits
output to 4 MiB and execution to 45 seconds. Credentials are accepted only for `connect`, passed
over stdin, and never persisted. Session tokens and encryption material are serialized by this
bridge into an AES-256-GCM vault supplied by the extension. The vault file is restricted to `0600`
inside a `0700` directory; the independent wrapping key arrives per invocation from VS Code
SecretStorage and is never stored in the vault. No Secret Service/keyring daemon is used.

Every operation requires the absolute `vaultPath` ending in
`standard-notes-session.v1.json` and a base64url 256-bit `vaultKey`. Writes use a fresh random nonce
and atomic replacement. Unsafe paths/files, invalid permissions, malformed envelopes, wrong keys,
and authentication failures are rejected without exposing upstream or secret material.

The pinned client sends Standard Notes client/version headers on authentication and sync. Server
URLs must be absolute HTTP(S) endpoints without embedded credentials, query strings, or fragments.
Connection errors are reduced to sanitized actionable categories; upstream bodies, email addresses,
passwords, and tokens never cross the helper response boundary.

The sync request supplies an ordered project/folder tag path. The bridge creates or reuses native
Standard Notes `TagToParentTag` references, attaches the note only to the leaf, returns the exact
managed UUID path, and uses those UUIDs for later migration and Trash cleanup. If native nesting is
disabled in a compatible build, the same planner emits only the project root; it never encodes a
hierarchy into one dotted title.

`pull-project` is read-only. It returns active notes referenced by the exact native project tag
hierarchy and recognizes the previous AIC `project:*`/`path:*` and dotted layouts for migration.
An empty duplicate project tag left by an interrupted migration is ignored. Multiple historical
active roots are read as one logical project inventory and writes follow the branch already holding
the exact note, or one stable branch for a new attachment. Unrelated and trashed notes are omitted.
A later unbound sync recovers an existing remote by exact managed path plus title before it considers
creating a note. Divergent duplicate identities are returned as candidates for one host-side choice;
the bridge never deletes the unselected items.

Build both release targets from the same package with Go 1.25.1:

```sh
go test ./...
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -buildid=' \
  -o ../bin/linux-x64/aic-notes-sn-bridge .
GOOS=js GOARCH=wasm CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -buildid=' \
  -o ../bin/wasm/aic-notes-sn-bridge.wasm .
```
