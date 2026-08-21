package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jonhadfield/gosn-v2/auth"
	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/items"
	"github.com/jonhadfield/gosn-v2/session"
)

const (
	maxRequestBytes = 2 * 1024 * 1024
	aicEditorID     = "com.dzyha.standard-notes-aic"
)

type request struct {
	Operation    string   `json:"operation"`
	Email        string   `json:"email,omitempty"`
	Password     string   `json:"password,omitempty"`
	Server       string   `json:"server,omitempty"`
	TokenName    string   `json:"tokenName,omitempty"`
	Token        string   `json:"token,omitempty"`
	LocalContent string   `json:"localContent,omitempty"`
	Title        string   `json:"title,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	RemoteUUID   string   `json:"remoteUuid,omitempty"`
	BaseHash     string   `json:"baseHash,omitempty"`
	Resolution   string   `json:"resolution,omitempty"`
}

type response struct {
	OK            bool     `json:"ok"`
	Code          string   `json:"code,omitempty"`
	Message       string   `json:"message,omitempty"`
	Fixes         []string `json:"fixes,omitempty"`
	Connected     bool     `json:"connected,omitempty"`
	Email         string   `json:"email,omitempty"`
	MFARequired   bool     `json:"mfaRequired,omitempty"`
	TokenName     string   `json:"tokenName,omitempty"`
	Action        string   `json:"action,omitempty"`
	LocalContent  string   `json:"localContent"`
	RemoteUUID    string   `json:"remoteUuid,omitempty"`
	BaseHash      string   `json:"baseHash,omitempty"`
	SyncedAt      string   `json:"syncedAt,omitempty"`
	ManagedTags   []string `json:"managedTags,omitempty"`
	RemoteChanged bool     `json:"remoteChanged,omitempty"`
}

func main() {
	defer func() {
		if recovered := recover(); recovered != nil {
			write(response{OK: false, Code: "sn_bridge_panic", Message: "the Standard Notes bridge stopped safely", Fixes: []string{"Retry, then reinstall the matching VSIX if the problem persists"}})
		}
	}()
	limited := io.LimitReader(os.Stdin, maxRequestBytes+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		write(response{OK: false, Code: "sn_bridge_protocol", Message: "request could not be read"})
		return
	}
	write(handle(payload))
}

func handle(payload []byte) response {
	if len(payload) > maxRequestBytes {
		return response{OK: false, Code: "sn_request_too_large", Message: "request exceeds the 2 MiB bridge limit"}
	}
	var input request
	if err := json.Unmarshal(payload, &input); err != nil {
		return response{OK: false, Code: "sn_bridge_protocol", Message: "request is not valid JSON"}
	}
	switch input.Operation {
	case "status":
		return status()
	case "connect":
		return connect(input)
	case "sync":
		return syncNote(input)
	default:
		return response{OK: false, Code: "sn_bridge_operation", Message: "unsupported bridge operation"}
	}
}

func write(output response) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(true)
	_ = encoder.Encode(output)
}

func status() response {
	if err := session.SessionExists(nil); err != nil {
		return response{OK: false, Code: "sn_not_connected", Message: "no Standard Notes session exists in the operating-system keychain", Fixes: []string{"Choose Connect from the AIC Notes sync action"}}
	}
	return response{OK: true, Connected: true}
}

func connect(input request) response {
	if strings.TrimSpace(input.Email) == "" || input.Password == "" {
		return response{OK: false, Code: "sn_credentials_required", Message: "email and password are required"}
	}
	server := strings.TrimRight(strings.TrimSpace(input.Server), "/")
	if server == "" {
		server = common.APIServer
	}
	result, err := auth.SignIn(auth.SignInInput{
		HTTPClient: common.NewHTTPClient(),
		Email:      input.Email,
		Password:   input.Password,
		APIServer:  server,
		TokenName:  input.TokenName,
		TokenVal:   input.Token,
		Debug:      false,
	})
	if err != nil {
		return failure("sn_connect_failed", err, "Check the server, credentials, and network connection")
	}
	if result.TokenName != "" {
		return response{OK: true, MFARequired: true, TokenName: result.TokenName}
	}
	if result.Session.AccessToken == "" {
		return response{OK: false, Code: "sn_connect_failed", Message: "Standard Notes returned no access token"}
	}
	s := sessionFromAuth(result.Session, server)
	if err := session.UpdateSession(&s, nil, false); err != nil {
		return failure("sn_keychain_failed", err, "Unlock a Secret Service compatible keyring and retry")
	}
	return response{OK: true, Connected: true, Email: input.Email}
}

func sessionFromAuth(input auth.SignInResponseDataSession, server string) session.Session {
	return session.Session{
		HTTPClient:         common.NewHTTPClient(),
		Server:             server,
		MasterKey:          input.MasterKey,
		KeyParams:          input.KeyParams,
		AccessToken:        input.AccessToken,
		RefreshToken:       input.RefreshToken,
		AccessExpiration:   input.AccessExpiration,
		RefreshExpiration:  input.RefreshExpiration,
		ReadOnlyAccess:     input.ReadOnlyAccess,
		PasswordNonce:      input.PasswordNonce,
		AccessTokenCookie:  input.AccessTokenCookie,
		RefreshTokenCookie: input.RefreshTokenCookie,
	}
}

func loadSession() (session.Session, error) {
	s, _, err := session.GetSession(common.NewHTTPClient(), true, "", common.APIServer, false)
	if err != nil {
		return session.Session{}, err
	}
	if s.Server == "" {
		s.Server = common.APIServer
	}
	return s, nil
}

func syncNote(input request) response {
	if strings.TrimSpace(input.Title) == "" {
		return response{OK: false, Code: "sn_title_required", Message: "the note title is empty"}
	}
	s, err := loadSession()
	if err != nil {
		return failure("sn_not_connected", err, "Reconnect AIC Notes to Standard Notes")
	}
	pull, err := items.Sync(items.SyncInput{Session: &s})
	if err != nil {
		return failure("sn_sync_failed", err, "Check the network connection and reconnect if the session expired")
	}
	if err := session.UpdateSession(&s, nil, false); err != nil {
		return failure("sn_keychain_failed", err, "Unlock the operating-system keyring and retry")
	}
	decrypted, err := pull.Items.DecryptAndParse(&s)
	if err != nil {
		return failure("sn_decrypt_failed", err, "Reconnect to refresh account encryption keys")
	}

	var remote *items.Note
	for _, note := range decrypted.Notes() {
		if note.UUID == input.RemoteUUID {
			candidate := note
			remote = &candidate
			break
		}
	}
	if input.RemoteUUID != "" && remote == nil {
		return response{OK: false, Code: "sn_remote_missing", Message: "the bound Standard Notes item no longer exists", Fixes: []string{"Restore that remote note or clear this note's workspace sync binding deliberately"}}
	}
	remoteHash := ""
	if remote != nil {
		remoteHash = contentHash(remote.Content.Text)
	}
	localHash := contentHash(input.LocalContent)
	action := syncDecision(localHash, remoteHash, input.BaseHash, input.Resolution)
	if action == "conflict" {
		return response{OK: true, Action: "conflict", RemoteUUID: remote.UUID, BaseHash: input.BaseHash, RemoteChanged: true}
	}

	if remote == nil {
		created, createErr := items.NewNote(input.Title, input.LocalContent, items.ItemReferences{})
		if createErr != nil {
			return failure("sn_note_invalid", createErr, "Give the note a non-empty title")
		}
		remote = &created
		action = "push"
	}

	var outgoing items.Items
	if action == "push" {
		remote.Content.Title = input.Title
		remote.Content.Text = input.LocalContent
		remote.Content.NoteType = "markdown"
		remote.Content.EditorIdentifier = aicEditorID
		remote.Content.Spellcheck = true
		remote.Content.PreviewPlain = plainPreview(input.LocalContent)
		remote.Content.SetUpdateTime(time.Now().UTC())
		outgoing = append(outgoing, remote)
	}

	tags := decrypted.Tags()
	tagItems, err := reconcileTags(tags, remote.UUID, input.Tags)
	if err != nil {
		return failure("sn_tags_failed", err, "Remove duplicate managed tags and retry")
	}
	for index := range tagItems {
		outgoing = append(outgoing, &tagItems[index])
	}
	if len(outgoing) > 0 {
		encrypted, encryptErr := outgoing.Encrypt(&s, s.DefaultItemsKey)
		if encryptErr != nil {
			return failure("sn_encrypt_failed", encryptErr, "Reconnect to refresh account encryption keys")
		}
		pushed, pushErr := items.Sync(items.SyncInput{Session: &s, Items: encrypted})
		if pushErr != nil {
			return failure("sn_sync_failed", pushErr, "Retry after checking the network connection")
		}
		if len(pushed.Conflicts) > 0 || len(pushed.Unsaved) > 0 {
			return response{OK: false, Code: "sn_server_conflict", Message: "Standard Notes rejected a conflicting update", Fixes: []string{"Sync again to review the current remote version"}}
		}
	}

	content := input.LocalContent
	if action == "pull" {
		content = remote.Content.Text
	}
	baseHash := contentHash(content)
	if action == "noop" && remoteHash != "" {
		baseHash = remoteHash
	}
	return response{
		OK:           true,
		Action:       action,
		LocalContent: content,
		RemoteUUID:   remote.UUID,
		BaseHash:     baseHash,
		SyncedAt:     time.Now().UTC().Format(time.RFC3339),
		ManagedTags:  input.Tags,
	}
}

func reconcileTags(existing items.Tags, noteUUID string, required []string) (items.Tags, error) {
	seen := map[string]int{}
	for _, tag := range existing {
		if isManagedTag(tag.Content.Title) {
			seen[tag.Content.Title]++
		}
	}
	for title, count := range seen {
		if count > 1 && (contains(required, title) || tagReferences(existing, title, noteUUID)) {
			return nil, fmt.Errorf("managed tag %q is duplicated", title)
		}
	}
	var changed items.Tags
	found := map[string]bool{}
	now := time.Now().UTC()
	for index := range existing {
		tag := existing[index]
		title := tag.Content.Title
		if !isManagedTag(title) {
			continue
		}
		wanted := contains(required, title)
		if wanted {
			found[title] = true
		}
		refs := tag.Content.References()
		next := make(items.ItemReferences, 0, len(refs)+1)
		had := false
		for _, ref := range refs {
			if ref.UUID == noteUUID {
				had = true
				if !wanted {
					continue
				}
			}
			next = append(next, ref)
		}
		if wanted && !had {
			next = append(next, items.ItemReference{UUID: noteUUID, ContentType: common.SNItemTypeNote})
		}
		if had != wanted {
			tag.Content.SetReferences(next)
			tag.Content.SetUpdateTime(now)
			changed = append(changed, tag)
		}
	}
	for _, title := range required {
		if found[title] {
			continue
		}
		tag, err := items.NewTag(title, items.ItemReferences{{UUID: noteUUID, ContentType: common.SNItemTypeNote}})
		if err != nil {
			return nil, err
		}
		changed = append(changed, tag)
	}
	return changed, nil
}

func tagReferences(tags items.Tags, title, noteUUID string) bool {
	for _, tag := range tags {
		if tag.Content.Title != title {
			continue
		}
		for _, ref := range tag.Content.References() {
			if ref.UUID == noteUUID {
				return true
			}
		}
	}
	return false
}

func plainPreview(markdown string) string {
	value := strings.Join(strings.Fields(markdown), " ")
	if len([]rune(value)) > 240 {
		return string([]rune(value)[:239]) + "…"
	}
	return value
}

func failure(code string, _ error, fix string) response {
	// Upstream errors can contain request metadata. Keep stdout deliberately
	// secret-free; the stable code and concrete fix are sufficient for the UI.
	return response{OK: false, Code: code, Message: strings.ReplaceAll(code, "_", " "), Fixes: []string{fix}}
}
