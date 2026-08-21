package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jonhadfield/gosn-v2/session"
	"github.com/zalando/go-keyring"
)

func testVaultRequest(t *testing.T) request {
	t.Helper()
	key := base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	return request{
		VaultPath: filepath.Join(t.TempDir(), vaultFileName),
		VaultKey:  key,
	}
}

func withTestVault(t *testing.T, input request) request {
	t.Helper()
	vault := testVaultRequest(t)
	input.VaultPath = vault.VaultPath
	input.VaultKey = vault.VaultKey
	return input
}

func TestVaultRoundTripUsesAuthenticatedRandomizedCiphertext(t *testing.T) {
	input := testVaultRequest(t)
	vault, err := vaultFromRequest(input)
	if err != nil {
		t.Fatal(err)
	}
	const secret = `{"access_token":"never-plaintext-on-disk"}`
	if err := vault.Set(session.KeyringService, session.KeyringApplicationName, secret); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(input.VaultPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(first), "never-plaintext-on-disk") {
		t.Fatal("vault contains plaintext session data")
	}
	if err := vault.Set(session.KeyringService, session.KeyringApplicationName, secret); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(input.VaultPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) == string(second) {
		t.Fatal("vault writes reused a nonce")
	}
	got, err := vault.Get(session.KeyringService, session.KeyringApplicationName)
	if err != nil || got != secret {
		t.Fatalf("round trip got %q, %v", got, err)
	}
	fileInfo, err := os.Stat(input.VaultPath)
	if err != nil {
		t.Fatal(err)
	}
	dirInfo, err := os.Stat(filepath.Dir(input.VaultPath))
	if err != nil {
		t.Fatal(err)
	}
	if fileInfo.Mode().Perm() != 0o600 || dirInfo.Mode().Perm() != 0o700 {
		t.Fatalf("unsafe permissions: file=%#o dir=%#o", fileInfo.Mode().Perm(), dirInfo.Mode().Perm())
	}
}

func TestVaultRejectsWrongKeyTamperingAndUnsafeFiles(t *testing.T) {
	input := testVaultRequest(t)
	vault, _ := vaultFromRequest(input)
	if err := vault.Set(session.KeyringService, session.KeyringApplicationName, "secret"); err != nil {
		t.Fatal(err)
	}

	wrong := input
	wrong.VaultKey = base64.RawURLEncoding.EncodeToString([]byte("abcdef0123456789abcdef0123456789"))
	wrongVault, _ := vaultFromRequest(wrong)
	if _, err := wrongVault.Get(session.KeyringService, session.KeyringApplicationName); err == nil {
		t.Fatal("wrong wrapping key unlocked the vault")
	}

	payload, err := os.ReadFile(input.VaultPath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope vaultEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[len(ciphertext)-1] ^= 1
	envelope.Ciphertext = base64.RawURLEncoding.EncodeToString(ciphertext)
	tampered, _ := json.Marshal(envelope)
	if err := os.WriteFile(input.VaultPath, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Get(session.KeyringService, session.KeyringApplicationName); err == nil {
		t.Fatal("tampered vault was accepted")
	}

	if err := os.Chmod(input.VaultPath, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Get(session.KeyringService, session.KeyringApplicationName); err == nil {
		t.Fatal("world-readable vault was accepted")
	}
}

func TestVaultValidationAndMissingSession(t *testing.T) {
	input := testVaultRequest(t)
	vault, err := vaultFromRequest(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := vault.Get(session.KeyringService, session.KeyringApplicationName); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("missing vault got %v", err)
	}
	for _, invalid := range []request{
		{VaultPath: "relative/" + vaultFileName, VaultKey: input.VaultKey},
		{VaultPath: filepath.Join(t.TempDir(), "wrong.json"), VaultKey: input.VaultKey},
		{VaultPath: input.VaultPath, VaultKey: "not-a-key"},
	} {
		if _, err := vaultFromRequest(invalid); err == nil {
			t.Fatalf("invalid vault contract accepted: %#v", invalid)
		}
	}
}

func TestSessionVaultPreservesReadOnlyState(t *testing.T) {
	input := testVaultRequest(t)
	vault, _ := vaultFromRequest(input)
	want := session.Session{
		Server:             "https://notes.example.test",
		MasterKey:          "master-key",
		AccessToken:        "access-token",
		RefreshToken:       "refresh-token",
		AccessExpiration:   123,
		RefreshExpiration:  456,
		ReadOnlyAccess:     true,
		PasswordNonce:      "password-nonce",
		AccessTokenCookie:  "access-cookie",
		RefreshTokenCookie: "refresh-cookie",
	}
	if err := saveSession(vault, want); err != nil {
		t.Fatal(err)
	}
	got, err := readSession(vault)
	if err != nil {
		t.Fatal(err)
	}
	if got.Server != want.Server || got.MasterKey != want.MasterKey || got.AccessToken != want.AccessToken ||
		got.RefreshToken != want.RefreshToken || got.ReadOnlyAccess != want.ReadOnlyAccess ||
		got.PasswordNonce != want.PasswordNonce || got.AccessTokenCookie != want.AccessTokenCookie ||
		got.RefreshTokenCookie != want.RefreshTokenCookie {
		t.Fatalf("session fields changed: %#v", got)
	}
	statusResponse := status(input)
	if !statusResponse.OK || !statusResponse.Connected || !statusResponse.ReadOnly {
		t.Fatalf("status did not preserve read-only state: %#v", statusResponse)
	}
}

func TestDisconnectRemovesOnlyTheValidatedLocalVaultAndIsIdempotent(t *testing.T) {
	input := testVaultRequest(t)
	if got := disconnect(input); !got.OK || got.Action != "disconnected" {
		t.Fatalf("missing-vault disconnect failed: %#v", got)
	}
	vault, _ := vaultFromRequest(input)
	if err := vault.Set(session.KeyringService, session.KeyringApplicationName, "secret"); err != nil {
		t.Fatal(err)
	}
	if got := disconnect(input); !got.OK || got.Action != "disconnected" {
		t.Fatalf("disconnect failed: %#v", got)
	}
	if _, err := os.Lstat(input.VaultPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("vault remains after disconnect: %v", err)
	}
	if got := disconnect(input); !got.OK {
		t.Fatalf("repeated disconnect was not idempotent: %#v", got)
	}
}

func TestDisconnectRefusesUnsafeVaultObjects(t *testing.T) {
	input := testVaultRequest(t)
	target := filepath.Join(t.TempDir(), "owner-file")
	if err := os.WriteFile(target, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, input.VaultPath); err != nil {
		t.Fatal(err)
	}
	got := disconnect(input)
	if got.OK || got.Code != "sn_vault_delete_failed" {
		t.Fatalf("unsafe vault disconnect got %#v", got)
	}
	if payload, err := os.ReadFile(target); err != nil || string(payload) != "keep" {
		t.Fatalf("unsafe target changed: %q, %v", payload, err)
	}
}
