package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/jonhadfield/gosn-v2/auth"
	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/session"
	"github.com/zalando/go-keyring"
)

const (
	vaultFileName = "standard-notes-session.v1.json"
	vaultVersion  = 1
	maxVaultBytes = 512 * 1024
)

var vaultAAD = []byte("aic-notes:standard-notes-session:v1")

type vaultEnvelope struct {
	Version    int    `json:"version"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type sessionVault struct {
	path string
	key  []byte
}

type persistedSession struct {
	Server             string         `json:"server"`
	Token              string         `json:"token,omitempty"`
	MasterKey          string         `json:"master_key"`
	KeyParams          auth.KeyParams `json:"keyParams"`
	AccessToken        string         `json:"access_token"`
	RefreshToken       string         `json:"refresh_token"`
	AccessExpiration   int64          `json:"access_expiration"`
	RefreshExpiration  int64          `json:"refresh_expiration"`
	SchemaValidation   bool           `json:"schema_validation,omitempty"`
	ReadOnlyAccess     bool           `json:"readonly_access,omitempty"`
	PasswordNonce      string         `json:"password_nonce,omitempty"`
	AccessTokenCookie  string         `json:"access_token_cookie,omitempty"`
	RefreshTokenCookie string         `json:"refresh_token_cookie,omitempty"`
}

func newSessionVault(path, encodedKey string) (*sessionVault, error) {
	clean := filepath.Clean(path)
	if path == "" || !filepath.IsAbs(path) || clean != path || filepath.Base(clean) != vaultFileName {
		return nil, errors.New("vault path is invalid")
	}
	key, err := base64.RawURLEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return nil, errors.New("vault key is invalid")
	}
	return &sessionVault{path: clean, key: key}, nil
}

func vaultFromRequest(input request) (*sessionVault, error) {
	return newSessionVault(input.VaultPath, input.VaultKey)
}

func (v *sessionVault) aead() (cipher.AEAD, error) {
	block, err := aes.NewCipher(v.key)
	if err != nil {
		return nil, errors.New("vault cipher is unavailable")
	}
	return cipher.NewGCM(block)
}

func (v *sessionVault) Set(service, user, secret string) error {
	if service != session.KeyringService || user != session.KeyringApplicationName {
		return errors.New("vault identity is invalid")
	}
	aead, err := v.aead()
	if err != nil {
		return err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return errors.New("vault nonce could not be generated")
	}
	ciphertext := aead.Seal(nil, nonce, []byte(secret), vaultAAD)
	envelope, err := json.Marshal(vaultEnvelope{
		Version:    vaultVersion,
		Nonce:      base64.RawURLEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawURLEncoding.EncodeToString(ciphertext),
	})
	if err != nil {
		return errors.New("vault envelope could not be encoded")
	}
	if len(envelope) > maxVaultBytes {
		return errors.New("vault envelope is too large")
	}
	return v.writeAtomic(envelope)
}

func (v *sessionVault) Get(service, user string) (string, error) {
	if service != session.KeyringService || user != session.KeyringApplicationName {
		return "", errors.New("vault identity is invalid")
	}
	info, err := os.Lstat(v.path)
	if errors.Is(err, os.ErrNotExist) {
		return "", keyring.ErrNotFound
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 {
		return "", errors.New("vault file is unsafe")
	}
	file, err := os.Open(v.path)
	if err != nil {
		return "", errors.New("vault file could not be opened")
	}
	defer file.Close()
	payload, err := io.ReadAll(io.LimitReader(file, maxVaultBytes+1))
	if err != nil || len(payload) > maxVaultBytes {
		return "", errors.New("vault file could not be read safely")
	}
	var envelope vaultEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil || envelope.Version != vaultVersion {
		return "", errors.New("vault envelope is invalid")
	}
	nonce, nonceErr := base64.RawURLEncoding.DecodeString(envelope.Nonce)
	ciphertext, cipherErr := base64.RawURLEncoding.DecodeString(envelope.Ciphertext)
	aead, aeadErr := v.aead()
	if nonceErr != nil || cipherErr != nil || aeadErr != nil || len(nonce) != aead.NonceSize() {
		return "", errors.New("vault envelope is invalid")
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, vaultAAD)
	if err != nil {
		return "", errors.New("vault authentication failed")
	}
	return string(plaintext), nil
}

func (v *sessionVault) Delete(service, user string) error {
	if service != session.KeyringService || user != session.KeyringApplicationName {
		return errors.New("vault identity is invalid")
	}
	if err := os.Remove(v.path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return keyring.ErrNotFound
		}
		return errors.New("vault file could not be removed")
	}
	return nil
}

func (v *sessionVault) writeAtomic(payload []byte) error {
	directory := filepath.Dir(v.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return errors.New("vault directory could not be created")
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("vault directory is unsafe")
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return errors.New("vault directory permissions could not be secured")
	}
	temporary, err := os.CreateTemp(directory, ".aic-notes-session-*")
	if err != nil {
		return errors.New("vault temporary file could not be created")
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return errors.New("vault temporary permissions could not be secured")
	}
	if _, err := temporary.Write(payload); err != nil {
		return errors.New("vault temporary file could not be written")
	}
	if err := temporary.Sync(); err != nil {
		return errors.New("vault temporary file could not be synchronized")
	}
	if err := temporary.Close(); err != nil {
		return errors.New("vault temporary file could not be closed")
	}
	closed = true
	if existing, err := os.Lstat(v.path); err == nil {
		if !existing.Mode().IsRegular() || existing.Mode()&os.ModeSymlink != 0 {
			return errors.New("vault destination is unsafe")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return errors.New("vault destination could not be inspected")
	}
	if err := os.Rename(temporaryPath, v.path); err != nil {
		return errors.New("vault could not be replaced atomically")
	}
	if err := os.Chmod(v.path, 0o600); err != nil {
		return errors.New("vault permissions could not be secured")
	}
	return nil
}

func encodeSession(value session.Session) (string, error) {
	payload, err := json.Marshal(persistedSession{
		Server:             value.Server,
		Token:              value.Token,
		MasterKey:          value.MasterKey,
		KeyParams:          value.KeyParams,
		AccessToken:        value.AccessToken,
		RefreshToken:       value.RefreshToken,
		AccessExpiration:   value.AccessExpiration,
		RefreshExpiration:  value.RefreshExpiration,
		SchemaValidation:   value.SchemaValidation,
		ReadOnlyAccess:     value.ReadOnlyAccess,
		PasswordNonce:      value.PasswordNonce,
		AccessTokenCookie:  value.AccessTokenCookie,
		RefreshTokenCookie: value.RefreshTokenCookie,
	})
	if err != nil {
		return "", errors.New("session could not be encoded")
	}
	return string(payload), nil
}

func decodeSession(value string) (session.Session, error) {
	var stored persistedSession
	if err := json.Unmarshal([]byte(value), &stored); err != nil || stored.AccessToken == "" || stored.MasterKey == "" {
		return session.Session{}, errors.New("stored session is invalid")
	}
	server := stored.Server
	if server == "" {
		server = common.APIServer
	}
	return session.Session{
		HTTPClient:         common.NewHTTPClient(),
		Server:             server,
		Token:              stored.Token,
		MasterKey:          stored.MasterKey,
		KeyParams:          stored.KeyParams,
		AccessToken:        stored.AccessToken,
		RefreshToken:       stored.RefreshToken,
		AccessExpiration:   stored.AccessExpiration,
		RefreshExpiration:  stored.RefreshExpiration,
		SchemaValidation:   stored.SchemaValidation,
		ReadOnlyAccess:     stored.ReadOnlyAccess,
		PasswordNonce:      stored.PasswordNonce,
		AccessTokenCookie:  stored.AccessTokenCookie,
		RefreshTokenCookie: stored.RefreshTokenCookie,
	}, nil
}

func saveSession(vault *sessionVault, value session.Session) error {
	encoded, err := encodeSession(value)
	if err != nil {
		return err
	}
	if err := vault.Set(session.KeyringService, session.KeyringApplicationName, encoded); err != nil {
		return fmt.Errorf("save session: %w", err)
	}
	return nil
}

func readSession(vault *sessionVault) (session.Session, error) {
	encoded, err := vault.Get(session.KeyringService, session.KeyringApplicationName)
	if err != nil {
		return session.Session{}, err
	}
	return decodeSession(encoded)
}
