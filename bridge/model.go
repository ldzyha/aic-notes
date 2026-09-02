package main

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func contentHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func syncDecision(localHash, remoteHash, baseHash, resolution string) string {
	if baseHash == "" {
		if remoteHash == "" {
			return "push"
		}
		if localHash == remoteHash {
			return "noop"
		}
		// A first binding has no common ancestor, but an explicit user choice is
		// still authoritative. Ignoring it here made the host ask the same
		// question after every retry without ever establishing a binding.
		if resolution == "local" {
			return "push"
		}
		if resolution == "remote" {
			return "pull"
		}
		return "conflict"
	}
	localChanged := localHash != baseHash
	remoteChanged := remoteHash != baseHash
	switch {
	case !localChanged && !remoteChanged:
		return "noop"
	case localChanged && !remoteChanged:
		return "push"
	case !localChanged && remoteChanged:
		return "pull"
	case localHash == remoteHash:
		return "noop"
	case resolution == "local":
		return "push"
	case resolution == "remote":
		return "pull"
	default:
		return "conflict"
	}
}

func readOnlySyncDecision(localHash, remoteHash, baseHash, resolution string) (action string, useRemote bool, nextBase string) {
	switch {
	case localHash == remoteHash:
		return "noop", false, remoteHash
	case resolution == "remote":
		// Read-only prevents a push, not an explicit decision to accept the
		// remote body. This is also how a locked duplicate can be chosen as the
		// canonical local binding.
		return "pull", true, remoteHash
	case baseHash != "" && localHash == baseHash:
		return "pull", true, remoteHash
	default:
		return "locked", false, baseHash
	}
}

func isLegacyManagedTag(value string) bool {
	return value == "aic" || strings.HasPrefix(value, "project:") || strings.HasPrefix(value, "path:")
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
