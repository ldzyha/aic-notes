package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSyncDecision(t *testing.T) {
	tests := []struct {
		name, local, remote, base, resolution, want string
	}{
		{"create", "local", "", "", "", "push"},
		{"initial remote ambiguity", "local", "remote", "", "", "conflict"},
		{"local only", "local-2", "base", "base", "", "push"},
		{"remote only", "base", "remote-2", "base", "", "pull"},
		{"both", "local-2", "remote-2", "base", "", "conflict"},
		{"choose local", "local-2", "remote-2", "base", "local", "push"},
		{"choose remote", "local-2", "remote-2", "base", "remote", "pull"},
		{"same result", "same", "same", "base", "", "noop"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := syncDecision(test.local, test.remote, test.base, test.resolution); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestReadOnlySyncDecisionNeverPushes(t *testing.T) {
	tests := []struct {
		name, local, remote, base, action, nextBase string
		useRemote                                   bool
	}{
		{"same", "same", "same", "old", "noop", "same", false},
		{"remote only", "base", "remote", "base", "pull", "remote", true},
		{"local only", "local", "base", "base", "locked", "base", false},
		{"both", "local", "remote", "base", "locked", "base", false},
		{"unbased", "local", "remote", "", "locked", "", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			action, useRemote, nextBase := readOnlySyncDecision(test.local, test.remote, test.base)
			if action != test.action || useRemote != test.useRemote || nextBase != test.nextBase {
				t.Fatalf("got %q, %v, %q; want %q, %v, %q", action, useRemote, nextBase, test.action, test.useRemote, test.nextBase)
			}
			if action == "push" {
				t.Fatal("read-only decision attempted a push")
			}
		})
	}
}

func TestManagedTagBoundary(t *testing.T) {
	for _, value := range []string{"aic", "project:demo", "path:src/lib"} {
		if !isManagedTag(value) {
			t.Fatalf("expected managed tag %q", value)
		}
	}
	for _, value := range []string{"aic-user", "project", "pathology", "topic:demo"} {
		if isManagedTag(value) {
			t.Fatalf("must preserve unrelated tag %q", value)
		}
	}
}

func TestHandleRejectsInvalidAndOversizedInput(t *testing.T) {
	if got := handle([]byte("not json")).Code; got != "sn_bridge_protocol" {
		t.Fatalf("invalid JSON returned %q", got)
	}
	if got := handle([]byte(strings.Repeat("x", maxRequestBytes+1))).Code; got != "sn_request_too_large" {
		t.Fatalf("oversized input returned %q", got)
	}
	if got := handle([]byte(`{"operation":"unknown"}`)).Code; got != "sn_bridge_operation" {
		t.Fatalf("unknown operation returned %q", got)
	}
}

func TestCredentialFailureIsSecretFree(t *testing.T) {
	secret := "aic-test-password-never-echo"
	output := connect(request{Password: secret})
	payload, err := json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	if output.Code != "sn_credentials_required" {
		t.Fatalf("unexpected error code %q", output.Code)
	}
	if strings.Contains(string(payload), secret) {
		t.Fatal("credential appeared in bridge response")
	}
}
