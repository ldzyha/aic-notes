package main

import (
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/items"
	"github.com/jonhadfield/gosn-v2/session"
)

func TestNormalizeServer(t *testing.T) {
	tests := []struct {
		name, input, fallback, want string
		valid                       bool
	}{
		{"default", "", "https://api.standardnotes.com", "https://api.standardnotes.com", true},
		{"trim trailing slash", " https://notes.example.test/base/// ", "", "https://notes.example.test/base", true},
		{"self hosted HTTP", "http://127.0.0.1:3000", "", "http://127.0.0.1:3000", true},
		{"missing scheme", "notes.example.test", "", "", false},
		{"credentials", "https://user:secret@notes.example.test", "", "", false},
		{"query", "https://notes.example.test?token=secret", "", "", false},
		{"wrong scheme", "file:///tmp/notes", "", "", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeServer(test.input, test.fallback)
			if test.valid && (err != nil || got != test.want) {
				t.Fatalf("got %q, %v; want %q", got, err, test.want)
			}
			if !test.valid && err == nil {
				t.Fatalf("expected rejection, got %q", got)
			}
		})
	}
}

func TestConnectFailureClassificationIsSafe(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code string
	}{
		{"unsupported", errors.New("Your client version is no longer supported"), "sn_client_unsupported"},
		{"credentials", errors.New("Invalid email or password: private@example.test"), "sn_auth_rejected"},
		{"forbidden", errors.New("server returned 403 Forbidden response"), "sn_auth_rejected"},
		{"dns", errors.New("host cannot be resolved"), "sn_server_unreachable"},
		{"refused", errors.New("dial tcp 127.0.0.1: connect: connection refused"), "sn_server_unreachable"},
		{"TLS", x509.UnknownAuthorityError{}, "sn_tls_failed"},
		{"endpoint", errors.New("server returned 404 Not Found"), "sn_server_invalid"},
		{"unknown", errors.New("opaque upstream failure private@example.test"), "sn_connect_failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := connectFailure(test.err)
			if got.Code != test.code {
				t.Fatalf("got %q, want %q", got.Code, test.code)
			}
			encoded, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			for _, secret := range []string{"private@example.test", "opaque upstream failure"} {
				if strings.Contains(string(encoded), secret) {
					t.Fatalf("response leaked %q: %s", secret, encoded)
				}
			}
		})
	}
}

func TestPinnedClientHeadersReachAuthEndpoints(t *testing.T) {
	seen := map[string]http.Header{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		seen[req.URL.Path] = req.Header.Clone()
		writer.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/v2/login-params":
			fmt.Fprint(writer, `{"data":{"identifier":"test@example.com","pw_nonce":"94035583b5ec33b6d5cf7bb6bccde43c6e7014abe77df0c59a0efa45d31c2c60","version":"004"},"meta":{}}`)
		case "/v2/login":
			writer.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(writer, `{"data":{"error":{"message":"Invalid email or password.","tag":"invalid-auth"}},"meta":{}}`)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	secret := "bridge-contract-password-never-echo"
	got := connect(request{
		Operation: "connect",
		Email:     "test@example.com",
		Password:  secret,
		Server:    server.URL + "/",
	})
	if got.Code != "sn_auth_rejected" {
		t.Fatalf("got %#v", got)
	}
	for _, endpoint := range []string{"/v2/login-params", "/v2/login"} {
		headers, ok := seen[endpoint]
		if !ok {
			t.Fatalf("request did not reach %s", endpoint)
		}
		if headers.Get("X-SNJS-Version") != common.SNJSVersion {
			t.Fatalf("%s missing X-SNJS-Version", endpoint)
		}
		if headers.Get("X-Application-Version") != common.SNAppVersion {
			t.Fatalf("%s missing X-Application-Version", endpoint)
		}
		if headers.Get("User-Agent") != common.SNUserAgent {
			t.Fatalf("%s missing Standard Notes User-Agent", endpoint)
		}
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secret) || strings.Contains(string(encoded), "test@example.com") {
		t.Fatalf("connect response leaked credentials: %s", encoded)
	}
}

func TestMFAChallengeRemainsInteractiveAndSecretFree(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(writer, `{"data":{"error":{"message":"MFA required","payload":{"mfa_key":"totp"}}},"meta":{}}`)
	}))
	defer server.Close()

	got := connect(request{Email: "test@example.com", Password: "private-password", Server: server.URL})
	if !got.OK || !got.MFARequired || got.TokenName != "totp" {
		t.Fatalf("MFA challenge was not preserved: %#v", got)
	}
}

func TestPinnedClientHeadersReachSyncEndpoint(t *testing.T) {
	var headers http.Header
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, req *http.Request) {
		headers = req.Header.Clone()
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"data":{"retrieved_items":[],"saved_items":[],"unsaved":[],"conflicts":[],"sync_token":"sync","cursor_token":null}}`)
	}))
	defer server.Close()

	s := session.Session{
		HTTPClient:        common.NewHTTPClient(),
		Server:            server.URL,
		MasterKey:         "contract-master-key",
		AccessToken:       "contract-access-token",
		RefreshToken:      "contract-refresh-token",
		AccessExpiration:  1,
		RefreshExpiration: 1,
	}
	if _, err := items.Sync(items.SyncInput{Session: &s}); err != nil {
		t.Fatal(err)
	}
	if headers.Get("X-SNJS-Version") != common.SNJSVersion ||
		headers.Get("X-Application-Version") != common.SNAppVersion ||
		headers.Get("User-Agent") != common.SNUserAgent {
		t.Fatalf("sync request is missing Standard Notes client headers: %#v", headers)
	}
}
