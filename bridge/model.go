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

func readOnlySyncDecision(localHash, remoteHash, baseHash string) (action string, useRemote bool, nextBase string) {
	switch {
	case localHash == remoteHash:
		return "noop", false, remoteHash
	case baseHash != "" && localHash == baseHash:
		return "pull", true, remoteHash
	default:
		return "locked", false, baseHash
	}
}

func isManagedTag(value string, previous, required []string) bool {
	return isLegacyManagedTag(value) ||
		contains(previous, value) || contains(required, value)
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
