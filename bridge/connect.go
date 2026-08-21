package main

import (
	"crypto/x509"
	"errors"
	"net"
	"net/url"
	"strings"
)

func normalizeServer(value, fallback string) (string, error) {
	server := strings.TrimSpace(value)
	if server == "" {
		server = fallback
	}
	parsed, err := url.Parse(server)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("server must be an absolute HTTP or HTTPS URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("server URL cannot contain credentials, a query, or a fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed.String(), nil
}

func connectFailure(err error) response {
	if err == nil {
		return response{OK: false, Code: "sn_connect_failed", Message: "Standard Notes connection failed"}
	}
	message := strings.ToLower(err.Error())
	var unknownAuthority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var certificateInvalid x509.CertificateInvalidError
	var networkError net.Error
	switch {
	case errors.As(err, &unknownAuthority), errors.As(err, &hostname), errors.As(err, &certificateInvalid),
		strings.Contains(message, "tls"), strings.Contains(message, "x509"),
		strings.Contains(message, "certificate"):
		return response{
			OK:      false,
			Code:    "sn_tls_failed",
			Message: "the Standard Notes server TLS certificate could not be verified",
			Fixes:   []string{"Use a server with a trusted certificate and matching hostname"},
		}
	case errors.As(err, &networkError),
		strings.Contains(message, "no such host"), strings.Contains(message, "cannot be resolved"),
		strings.Contains(message, "connection refused"), strings.Contains(message, "network is unreachable"),
		strings.Contains(message, "i/o timeout"), strings.Contains(message, "context deadline exceeded"),
		strings.Contains(message, "service unavailable"), strings.Contains(message, "empty response"):
		return response{
			OK:      false,
			Code:    "sn_server_unreachable",
			Message: "the Standard Notes server could not be reached",
			Fixes:   []string{"Check the configured server, DNS, proxy, and network connection"},
		}
	case strings.Contains(message, "client version is no longer supported"),
		strings.Contains(message, "version 003 of standard notes"):
		return response{
			OK:      false,
			Code:    "sn_client_unsupported",
			Message: "Standard Notes rejected this client version",
			Fixes:   []string{"Install the latest public AIC Notes release"},
		}
	case strings.Contains(message, "401"), strings.Contains(message, "403"),
		strings.Contains(message, "unauthorized"), strings.Contains(message, "forbidden"),
		strings.Contains(message, "invalid login"), strings.Contains(message, "invalid credentials"),
		strings.Contains(message, "invalid email"), strings.Contains(message, "invalid password"),
		strings.Contains(message, "email or password"), strings.Contains(message, "incorrect email"),
		strings.Contains(message, "incorrect password"):
		return response{
			OK:      false,
			Code:    "sn_auth_rejected",
			Message: "Standard Notes rejected the account credentials or access request",
			Fixes:   []string{"Verify the email and password, then complete MFA if requested"},
		}
	case strings.Contains(message, "404"), strings.Contains(message, "not found"),
		strings.Contains(message, "unsupported protocol"), strings.Contains(message, "protocol is missing"),
		strings.Contains(message, "invalid url"):
		return response{
			OK:      false,
			Code:    "sn_server_invalid",
			Message: "the configured Standard Notes server is not a compatible API endpoint",
			Fixes:   []string{"Use the HTTPS sync-server URL accepted by the Standard Notes app"},
		}
	default:
		return response{
			OK:      false,
			Code:    "sn_connect_failed",
			Message: "Standard Notes connection failed",
			Fixes:   []string{"Verify the server and account details, then retry"},
		}
	}
}
