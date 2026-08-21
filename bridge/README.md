# AIC Notes Standard Notes bridge

This Linux x64 helper is the only process that handles Standard Notes authentication, encryption,
item sync, and tag references. It uses the pinned MIT `gosn-v2` module in `go.mod` directly.

Protocol: one JSON object on stdin and one JSON object on stdout. Supported operations are
`status`, `connect`, and `sync`. Input is limited to 2 MiB. The VS Code host additionally limits
output to 4 MiB and execution to 45 seconds. Credentials are accepted only for `connect`, passed
over stdin, and persisted by `gosn-v2` only through the operating-system keychain.

Build with Go 1.25.1:

```sh
go test ./...
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -buildid=' \
  -o ../bin/linux-x64/aic-notes-sn-bridge .
```
