package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jonhadfield/gosn-v2/auth"
	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/items"
	"github.com/jonhadfield/gosn-v2/session"
	"github.com/zalando/go-keyring"
)

const (
	maxRequestBytes          = 2 * 1024 * 1024
	aicEditorID              = "com.dzyha.standard-notes-aic"
	tagToParentReferenceType = "TagToParentTag"
	supportsNativeNestedTags = true
)

type request struct {
	Operation        string   `json:"operation"`
	Email            string   `json:"email,omitempty"`
	Password         string   `json:"password,omitempty"`
	Server           string   `json:"server,omitempty"`
	TokenName        string   `json:"tokenName,omitempty"`
	Token            string   `json:"token,omitempty"`
	LocalContent     string   `json:"localContent,omitempty"`
	Title            string   `json:"title,omitempty"`
	Kind             string   `json:"kind,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	PreviousTags     []string `json:"previousTags,omitempty"`
	PreviousTagUUIDs []string `json:"previousTagUuids,omitempty"`
	RemoteUUID       string   `json:"remoteUuid,omitempty"`
	BaseHash         string   `json:"baseHash,omitempty"`
	Resolution       string   `json:"resolution,omitempty"`
	Project          string   `json:"project,omitempty"`
	HostPlatform     string   `json:"hostPlatform,omitempty"`
	VaultPath        string   `json:"vaultPath,omitempty"`
	VaultKey         string   `json:"vaultKey,omitempty"`
}

type response struct {
	OK                 bool                      `json:"ok"`
	Code               string                    `json:"code,omitempty"`
	Message            string                    `json:"message,omitempty"`
	Fixes              []string                  `json:"fixes,omitempty"`
	Connected          bool                      `json:"connected,omitempty"`
	Email              string                    `json:"email,omitempty"`
	MFARequired        bool                      `json:"mfaRequired,omitempty"`
	TokenName          string                    `json:"tokenName,omitempty"`
	Action             string                    `json:"action,omitempty"`
	LocalContent       string                    `json:"localContent"`
	RemoteUUID         string                    `json:"remoteUuid,omitempty"`
	BaseHash           string                    `json:"baseHash,omitempty"`
	SyncedAt           string                    `json:"syncedAt,omitempty"`
	ManagedTags        []string                  `json:"managedTags,omitempty"`
	ManagedTagUUIDs    []string                  `json:"managedTagUuids,omitempty"`
	RemoteChanged      bool                      `json:"remoteChanged,omitempty"`
	ReadOnly           bool                      `json:"readOnly,omitempty"`
	Notes              []remoteProjectNote       `json:"notes,omitempty"`
	IdentityCandidates []remoteIdentityCandidate `json:"identityCandidates,omitempty"`
}

type remoteIdentityCandidate struct {
	RemoteUUID string `json:"remoteUuid"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
	Preview    string `json:"preview,omitempty"`
	ReadOnly   bool   `json:"readOnly,omitempty"`
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
		return status(input)
	case "connect":
		return connect(input)
	case "disconnect":
		return disconnect(input)
	case "sync":
		return syncNote(input)
	case "pull-project":
		return pullProject(input)
	case "trash":
		return trashNote(input)
	default:
		return response{OK: false, Code: "sn_bridge_operation", Message: "unsupported bridge operation"}
	}
}

func disconnect(input request) response {
	vault, err := vaultFromRequest(input)
	if err != nil {
		return failure("sn_vault_unavailable", err, "Reload code-server and retry")
	}
	if err := vault.Delete(session.KeyringService, session.KeyringApplicationName); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return failure("sn_vault_delete_failed", err, "Check extension storage permissions and retry")
	}
	return response{OK: true, Connected: false, Action: "disconnected"}
}

func status(input request) response {
	vault, err := vaultFromRequest(input)
	if err != nil {
		return failure("sn_vault_unavailable", err, "Reload code-server and retry the AIC Notes connection")
	}
	s, err := readSession(vault)
	if errors.Is(err, keyring.ErrNotFound) {
		return response{OK: false, Code: "sn_not_connected", Message: "no Standard Notes session exists", Fixes: []string{"Use the Secondary footer Log in icon or run AIC Notes: Sync Current Note"}}
	}
	if err != nil {
		return failure("sn_vault_unreadable", err, "Choose Reconnect to replace only the local encrypted session vault")
	}
	return response{OK: true, Connected: true, ReadOnly: s.ReadOnlyAccess}
}

func connect(input request) response {
	if strings.TrimSpace(input.Email) == "" || input.Password == "" {
		return response{OK: false, Code: "sn_credentials_required", Message: "email and password are required"}
	}
	vault, vaultErr := vaultFromRequest(input)
	if vaultErr != nil {
		return failure("sn_vault_unavailable", vaultErr, "Reload code-server and retry the AIC Notes connection")
	}
	server, serverErr := normalizeServer(input.Server, common.APIServer)
	if serverErr != nil {
		return response{
			OK:      false,
			Code:    "sn_server_invalid",
			Message: "the configured Standard Notes server URL is invalid",
			Fixes:   []string{"Use an absolute http:// or https:// sync-server URL without credentials, query, or fragment"},
		}
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
		return connectFailure(err)
	}
	if result.TokenName != "" {
		return response{OK: true, MFARequired: true, TokenName: result.TokenName}
	}
	if result.Session.AccessToken == "" {
		return response{OK: false, Code: "sn_auth_response_invalid", Message: "Standard Notes returned no access token", Fixes: []string{"Verify the server endpoint and retry"}}
	}
	s := sessionFromAuth(result.Session, server)
	if err := saveSession(vault, s); err != nil {
		return failure("sn_vault_write_failed", err, "Check extension storage permissions and retry")
	}
	return response{OK: true, Connected: true, Email: input.Email, ReadOnly: s.ReadOnlyAccess}
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

func loadSession(input request) (session.Session, *sessionVault, error) {
	vault, err := vaultFromRequest(input)
	if err != nil {
		return session.Session{}, nil, err
	}
	s, err := readSession(vault)
	if err != nil {
		return session.Session{}, vault, err
	}
	if time.Unix(s.AccessExpiration/1000, 0).Add(-session.RefreshSessionThreshold).Before(time.Now().UTC()) {
		if err := s.Refresh(); err != nil {
			return session.Session{}, vault, err
		}
		if err := saveSession(vault, s); err != nil {
			return session.Session{}, vault, err
		}
	}
	return s, vault, nil
}

func syncNote(input request) response {
	if strings.TrimSpace(input.Title) == "" {
		return response{OK: false, Code: "sn_title_required", Message: "the note title is empty"}
	}
	s, vault, err := loadSession(input)
	if err != nil {
		return failure("sn_not_connected", err, "Reconnect AIC Notes to Standard Notes")
	}
	pull, err := items.Sync(items.SyncInput{Session: &s})
	if err != nil {
		return failure("sn_sync_failed", err, "Check the network connection and reconnect if the session expired")
	}
	if err := saveSession(vault, s); err != nil {
		return failure("sn_vault_write_failed", err, "Check extension storage permissions and retry")
	}
	rawItems, err := items.DecryptItems(&s, pull.Items, []session.SessionItemsKey{})
	if err != nil {
		return failure("sn_decrypt_failed", err, "Reconnect to refresh account encryption keys")
	}
	lockedNotes := lockedNoteUUIDs(rawItems)
	decrypted, err := rawItems.Parse()
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
	if input.RemoteUUID == "" {
		discovered, ambiguous, discoverErr := discoverRemoteIdentity(
			decrypted.Notes(),
			decrypted.Tags(),
			input.Title,
			input.Tags,
			input.Kind,
			input.LocalContent,
		)
		if discoverErr != nil {
			return failure("sn_tag_identity_invalid", discoverErr, "Repair the malformed AIC project tag hierarchy in Standard Notes and retry")
		}
		if len(ambiguous) > 0 {
			return response{
				OK:                 true,
				Action:             "identity-conflict",
				IdentityCandidates: identityCandidateResponses(ambiguous, lockedNotes, s.ReadOnlyAccess),
				RemoteChanged:      true,
			}
		}
		remote = discovered
	}
	if input.RemoteUUID != "" && remote == nil {
		return response{OK: false, Code: "sn_remote_missing", Message: "the bound Standard Notes item no longer exists", Fixes: []string{"Restore that remote note or clear this note's workspace sync binding deliberately"}}
	}
	remoteHash := ""
	if remote != nil {
		remoteHash = contentHash(remote.Content.Text)
	}
	localHash := contentHash(input.LocalContent)
	readOnly := s.ReadOnlyAccess || (remote != nil && lockedNotes[remote.UUID])
	if remote == nil && readOnly {
		return response{OK: false, Code: "sn_note_read_only", Message: "the Standard Notes session is read-only", Fixes: []string{"Reconnect with write access before creating the remote note"}, ReadOnly: true}
	}
	if remote != nil && readOnly {
		action, useRemote, baseHash := readOnlySyncDecision(localHash, remoteHash, input.BaseHash, input.Resolution)
		content := input.LocalContent
		if useRemote {
			content = remote.Content.Text
		}
		return response{
			OK:            true,
			Action:        action,
			LocalContent:  content,
			RemoteUUID:    remote.UUID,
			BaseHash:      baseHash,
			SyncedAt:      time.Now().UTC().Format(time.RFC3339),
			RemoteChanged: remoteHash != input.BaseHash,
			ReadOnly:      true,
		}
	}
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
	tagResult, err := reconcileTagHierarchy(
		tags,
		remote.UUID,
		input.Tags,
		input.PreviousTags,
		input.PreviousTagUUIDs,
		supportsNativeNestedTags,
	)
	if err != nil {
		return failure("sn_tags_failed", err, "Resolve duplicate or malformed managed tags and retry")
	}
	for index := range tagResult.Changed {
		outgoing = append(outgoing, &tagResult.Changed[index])
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
		OK:              true,
		Action:          action,
		LocalContent:    content,
		RemoteUUID:      remote.UUID,
		BaseHash:        baseHash,
		SyncedAt:        time.Now().UTC().Format(time.RFC3339),
		ManagedTags:     tagResult.Titles,
		ManagedTagUUIDs: tagResult.UUIDs,
		ReadOnly:        false,
	}
}

// discoverRemoteNote is the strict discovery contract used by model tests and
// non-interactive callers: divergent duplicates remain an error. The sync
// endpoint uses discoverRemoteIdentity so the host can offer one explicit,
// persistent binding choice instead of an unactionable failure notification.
func discoverRemoteNote(notes items.Notes, tags items.Tags, title string, tagPath []string, kind string) (*items.Note, error) {
	note, ambiguous, err := discoverRemoteIdentity(notes, tags, title, tagPath, kind, "")
	if err != nil {
		return nil, err
	}
	if len(ambiguous) > 0 {
		return nil, fmt.Errorf("note title %q is duplicated with divergent content at managed path %q", title, strings.Join(tagPath, "/"))
	}
	return note, nil
}

// discoverRemoteIdentity recovers a lost local workspace binding without creating
// a duplicate Standard Notes item. AIC's identity is the exact managed tag
// path plus the exact note title. When old clients produced divergent duplicate
// identities, an exact local-body match is a safe automatic discriminator;
// otherwise every candidate is returned for one explicit host-side choice.
func discoverRemoteIdentity(notes items.Notes, tags items.Tags, title string, tagPath []string, kind string, localContent string) (*items.Note, items.Notes, error) {
	if len(tagPath) == 0 || strings.TrimSpace(tagPath[0]) == "" {
		return nil, nil, nil
	}
	assignments, err := projectTagAssignments(tags, tagPath[0])
	if err != nil {
		return nil, nil, err
	}
	wantedPath := strings.Join(tagPath, "\x00")
	matches := items.Notes{}
	for _, note := range notes {
		if note.IsDeleted() || (note.Content.Trashed != nil && *note.Content.Trashed) ||
			note.Content.Title != title || !remoteMarkdownKindMatches(note, kind) {
			continue
		}
		assignment, ok := assignments[note.UUID]
		if !ok || strings.Join(assignment.Path, "\x00") != wantedPath {
			continue
		}
		matches = append(matches, note)
	}
	if len(matches) > 0 {
		selected, ambiguous := selectRemoteIdentity(matches, localContent)
		return selected, ambiguous, nil
	}
	// Releases before native project tags could leave the root sidecar
	// completely untagged. Recover only the one canonical project-note whose
	// title and frontmatter title both equal the workspace root; the next sync
	// attaches the normal managed project tag before any deletion can occur.
	if kind == "note" && len(tagPath) == 1 {
		matches = items.Notes{}
		for _, note := range notes {
			_, tagged := assignments[note.UUID]
			if tagged || noteHasActiveTagReference(tags, note.UUID) || note.IsDeleted() ||
				(note.Content.Trashed != nil && *note.Content.Trashed) ||
				note.Content.Title != title ||
				markdownFrontmatterValue(note.Content.Text, "level") != "project-note" ||
				markdownFrontmatterValue(note.Content.Text, "title") != tagPath[0] {
				continue
			}
			matches = append(matches, note)
		}
		if len(matches) > 0 {
			selected, ambiguous := selectRemoteIdentity(matches, localContent)
			return selected, ambiguous, nil
		}
	}
	return nil, nil, nil
}

// selectRemoteIdentity makes every safe choice deterministically and returns
// divergent candidates without mutating Standard Notes. The host persists the
// UUID selected by the user, so the question is not repeated for that file.
func selectRemoteIdentity(matches items.Notes, localContent string) (*items.Note, items.Notes) {
	if len(matches) == 0 {
		return nil, nil
	}
	ordered := append(items.Notes(nil), matches...)
	sort.Slice(ordered, func(left, right int) bool { return ordered[left].UUID < ordered[right].UUID })
	representatives := make(items.Notes, 0, len(ordered))
	seenContent := map[string]bool{}
	for _, note := range ordered {
		if !seenContent[note.Content.Text] {
			seenContent[note.Content.Text] = true
			representatives = append(representatives, note)
		}
	}
	if len(representatives) == 1 {
		canonical := representatives[0]
		return &canonical, nil
	}
	for _, note := range representatives {
		if note.Content.Text == localContent {
			candidate := note
			return &candidate, nil
		}
	}
	return nil, representatives
}

func identityCandidateResponses(notes items.Notes, locked map[string]bool, sessionReadOnly bool) []remoteIdentityCandidate {
	result := make([]remoteIdentityCandidate, 0, len(notes))
	for _, note := range notes {
		updatedAt := note.GetUpdatedAt()
		if strings.TrimSpace(updatedAt) == "" {
			if updated, err := note.Content.GetUpdateTime(); err == nil && !updated.IsZero() {
				updatedAt = updated.UTC().Format(time.RFC3339)
			}
		}
		preview := strings.TrimSpace(note.Content.PreviewPlain)
		if preview == "" {
			preview = plainPreview(note.Content.Text)
		}
		result = append(result, remoteIdentityCandidate{
			RemoteUUID: note.UUID,
			UpdatedAt:  updatedAt,
			Preview:    preview,
			ReadOnly:   sessionReadOnly || locked[note.UUID],
		})
	}
	return result
}

func remoteMarkdownKindMatches(note items.Note, kind string) bool {
	if kind == "" {
		return true
	}
	level := markdownFrontmatterValue(note.Content.Text, "level")
	isSidecar := level == "project-note" || level == "folder-note" || level == "file-note"
	if kind == "note" {
		if isSidecar {
			return markdownFrontmatterValue(note.Content.Text, "title") == note.Content.Title
		}
		return level == "" && strings.HasSuffix(strings.ToLower(note.Content.Title), ".note.md")
	}
	if kind == "document" {
		lowerTitle := strings.ToLower(note.Content.Title)
		return !isSidecar && strings.HasSuffix(lowerTitle, ".md") && !strings.HasSuffix(lowerTitle, ".note.md")
	}
	return false
}

func markdownFrontmatterValue(markdown string, wanted string) string {
	text := strings.TrimPrefix(markdown, "\ufeff")
	if strings.HasPrefix(text, "---\n") || strings.HasPrefix(text, "---\r\n") {
		for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")[1:] {
			if line == "---" || line == "..." {
				break
			}
			if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") || strings.HasPrefix(line, "-") {
				continue
			}
			if key, value, found := strings.Cut(line, ":"); found && strings.TrimSpace(key) == wanted {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func prepareRemoteTrash(remote *items.Note, tags items.Tags, previousTags, previousTagUUIDs []string, now time.Time) (items.Items, string, error) {
	if remote == nil {
		return nil, "", errors.New("remote note is missing")
	}
	action := "already-trashed"
	var outgoing items.Items
	if remote.Content.Trashed == nil || !*remote.Content.Trashed {
		remote.Content.SetTrashed(true)
		remote.Content.SetUpdateTime(now)
		outgoing = append(outgoing, remote)
		action = "trashed"
	}
	tagItems, err := detachManagedTagReferences(tags, remote.UUID, previousTags, previousTagUUIDs)
	if err != nil {
		return nil, "", err
	}
	for index := range tagItems {
		outgoing = append(outgoing, &tagItems[index])
	}
	return outgoing, action, nil
}

func trashNote(input request) response {
	if strings.TrimSpace(input.RemoteUUID) == "" {
		return response{OK: false, Code: "sn_remote_binding_required", Message: "the note has no exact Standard Notes binding", Fixes: []string{"Keep the local note or synchronize it before retrying"}}
	}
	s, vault, err := loadSession(input)
	if err != nil {
		return failure("sn_not_connected", err, "Reconnect AIC Notes to Standard Notes")
	}
	pull, err := items.Sync(items.SyncInput{Session: &s})
	if err != nil {
		return failure("sn_sync_failed", err, "Check the network connection and reconnect if the session expired")
	}
	if err := saveSession(vault, s); err != nil {
		return failure("sn_vault_write_failed", err, "Check extension storage permissions and retry")
	}
	rawItems, err := items.DecryptItems(&s, pull.Items, []session.SessionItemsKey{})
	if err != nil {
		return failure("sn_decrypt_failed", err, "Reconnect to refresh account encryption keys")
	}
	lockedNotes := lockedNoteUUIDs(rawItems)
	decrypted, err := rawItems.Parse()
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
	if remote == nil {
		return response{OK: false, Code: "sn_remote_missing", Message: "the exactly bound Standard Notes item no longer exists", Fixes: []string{"Keep the local note and review the Standard Notes Trash before retrying"}}
	}
	if s.ReadOnlyAccess || lockedNotes[remote.UUID] {
		return response{OK: false, Code: "sn_note_read_only", Message: "the linked Standard Notes item is locked or read-only", Fixes: []string{"Unlock it in Standard Notes before deleting the local sidecar"}, RemoteUUID: remote.UUID, ReadOnly: true}
	}

	outgoing, action, err := prepareRemoteTrash(
		remote,
		decrypted.Tags(),
		input.PreviousTags,
		input.PreviousTagUUIDs,
		time.Now().UTC(),
	)
	if err != nil {
		return failure("sn_tags_failed", err, "Remove duplicate managed tags and retry")
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
			return response{OK: false, Code: "sn_server_conflict", Message: "Standard Notes rejected the Trash update", Fixes: []string{"Retry after reviewing the current remote note"}, RemoteUUID: remote.UUID}
		}
	}
	return response{
		OK:              true,
		Action:          action,
		RemoteUUID:      remote.UUID,
		SyncedAt:        time.Now().UTC().Format(time.RFC3339),
		ManagedTags:     []string{},
		ManagedTagUUIDs: []string{},
		ReadOnly:        false,
	}
}

type tagReconciliation struct {
	Changed items.Tags
	Titles  []string
	UUIDs   []string
}

func reconcileTagHierarchy(
	existing items.Tags,
	noteUUID string,
	requiredPath, previousTitles, previousUUIDs []string,
	nestedSupported bool,
) (tagReconciliation, error) {
	path, err := normalizedTagPath(requiredPath, nestedSupported)
	if err != nil {
		return tagReconciliation{}, err
	}
	working := append(items.Tags(nil), existing...)
	changed := map[string]bool{}
	pathIndexes := make([]int, 0, len(path))
	pathUUIDs := map[string]bool{}
	parentUUID := ""
	for _, title := range path {
		index, findErr := findTagByParentAndTitle(working, parentUUID, title, noteUUID)
		if findErr != nil {
			return tagReconciliation{}, findErr
		}
		if index < 0 {
			refs := items.ItemReferences{}
			if parentUUID != "" {
				refs = append(refs, items.ItemReference{
					UUID:          parentUUID,
					ContentType:   common.SNItemTypeTag,
					ReferenceType: tagToParentReferenceType,
				})
			}
			created, createErr := items.NewTag(title, refs)
			if createErr != nil {
				return tagReconciliation{}, createErr
			}
			working = append(working, created)
			index = len(working) - 1
			changed[created.UUID] = true
		}
		if pathUUIDs[working[index].UUID] {
			return tagReconciliation{}, fmt.Errorf("managed tag hierarchy contains a cycle at %q", title)
		}
		pathUUIDs[working[index].UUID] = true
		pathIndexes = append(pathIndexes, index)
		parentUUID = working[index].UUID
	}
	leafUUID := working[pathIndexes[len(pathIndexes)-1]].UUID
	if err := reconcileManagedTagReferences(
		working,
		changed,
		noteUUID,
		leafUUID,
		previousTitles,
		previousUUIDs,
	); err != nil {
		return tagReconciliation{}, err
	}
	result := tagReconciliation{
		Titles: make([]string, 0, len(pathIndexes)),
		UUIDs:  make([]string, 0, len(pathIndexes)),
	}
	for _, index := range pathIndexes {
		result.Titles = append(result.Titles, working[index].Content.Title)
		result.UUIDs = append(result.UUIDs, working[index].UUID)
	}
	for index := range working {
		if changed[working[index].UUID] {
			result.Changed = append(result.Changed, working[index])
		}
	}
	return result, nil
}

func normalizedTagPath(input []string, nestedSupported bool) ([]string, error) {
	path := make([]string, 0, len(input))
	for _, value := range input {
		if title := strings.TrimSpace(value); title != "" && title != "." {
			path = append(path, title)
		}
	}
	if len(path) == 0 {
		return nil, errors.New("managed project tag is empty")
	}
	if !nestedSupported && len(path) > 1 {
		path = path[:1]
	}
	return path, nil
}

func findTagByParentAndTitle(tags items.Tags, parentUUID, title, noteUUID string) (int, error) {
	candidates := []int{}
	for index := range tags {
		if tags[index].IsDeleted() || tags[index].Content.Title != title {
			continue
		}
		candidateParent, err := tagParentUUID(tags[index])
		if err != nil {
			return -1, err
		}
		if candidateParent != parentUUID {
			continue
		}
		candidates = append(candidates, index)
	}
	if len(candidates) <= 1 {
		if len(candidates) == 1 {
			return candidates[0], nil
		}
		return -1, nil
	}
	active := []int{}
	containingNote := []int{}
	for _, index := range candidates {
		if projectSubtreeNoteCount(tags, tags[index].UUID) > 0 {
			active = append(active, index)
			if projectSubtreeHasNote(tags, tags[index].UUID, noteUUID) {
				containingNote = append(containingNote, index)
			}
		}
	}
	if len(containingNote) > 0 {
		sort.Slice(containingNote, func(left, right int) bool {
			return tags[containingNote[left]].UUID < tags[containingNote[right]].UUID
		})
		return containingNote[0], nil
	}
	if len(active) > 0 {
		// Old clients could create parallel active tag branches. They are all
		// readable as one logical path; for a new attachment choose the same
		// stable branch on every client without deleting any existing branch.
		sort.Slice(active, func(left, right int) bool {
			return tags[active[left]].UUID < tags[active[right]].UUID
		})
		return active[0], nil
	}
	sort.Slice(candidates, func(left, right int) bool {
		return tags[candidates[left]].UUID < tags[candidates[right]].UUID
	})
	return candidates[0], nil
}

func projectSubtreeHasNote(tags items.Tags, rootUUID, noteUUID string) bool {
	if strings.TrimSpace(noteUUID) == "" {
		return false
	}
	inside := map[string]bool{rootUUID: true}
	for changed := true; changed; {
		changed = false
		for _, tag := range tags {
			if inside[tag.UUID] {
				continue
			}
			parent, err := tagParentUUID(tag)
			if err == nil && inside[parent] {
				inside[tag.UUID] = true
				changed = true
			}
		}
	}
	for _, tag := range tags {
		if inside[tag.UUID] && tagHasReference(tag, noteUUID) {
			return true
		}
	}
	return false
}

func tagParentUUID(tag items.Tag) (string, error) {
	parentUUID := ""
	parentReferences := 0
	for _, ref := range tag.Content.References() {
		if ref.ReferenceType != tagToParentReferenceType {
			continue
		}
		parentReferences++
		if ref.ContentType != common.SNItemTypeTag || strings.TrimSpace(ref.UUID) == "" {
			return "", fmt.Errorf("tag %q has an invalid parent reference", tag.Content.Title)
		}
		if parentReferences > 1 {
			return "", fmt.Errorf("tag %q has multiple parent references", tag.Content.Title)
		}
		parentUUID = ref.UUID
	}
	if tag.Content.ParentId != "" {
		if parentUUID != "" && parentUUID != tag.Content.ParentId {
			return "", fmt.Errorf("tag %q has contradictory parent identities", tag.Content.Title)
		}
		parentUUID = tag.Content.ParentId
	}
	return parentUUID, nil
}

func reconcileManagedTagReferences(
	tags items.Tags,
	changed map[string]bool,
	noteUUID, keepUUID string,
	previousTitles, previousUUIDs []string,
) error {
	if len(previousUUIDs) == 0 {
		for _, title := range previousTitles {
			matches := 0
			for _, tag := range tags {
				if tag.Content.Title == title && tagHasReference(tag, noteUUID) {
					matches++
				}
			}
			if matches > 1 {
				return fmt.Errorf("previous managed tag %q is ambiguous", title)
			}
		}
	}
	now := time.Now().UTC()
	for index := range tags {
		tag := tags[index]
		keep := tag.UUID == keepUUID
		exactPrevious := contains(previousUUIDs, tag.UUID)
		legacyTitle := isLegacyManagedTag(tag.Content.Title)
		migrationTitle := len(previousUUIDs) == 0 && contains(previousTitles, tag.Content.Title)
		if !keep && !exactPrevious && !legacyTitle && !migrationTitle {
			continue
		}
		refs := tag.Content.References()
		next := make(items.ItemReferences, 0, len(refs)+1)
		hadNote := false
		for _, ref := range refs {
			if ref.UUID == noteUUID {
				hadNote = true
				if !keep {
					continue
				}
			}
			next = append(next, ref)
		}
		if keep && !hadNote {
			next = append(next, items.ItemReference{UUID: noteUUID, ContentType: common.SNItemTypeNote})
		}
		if keep == hadNote {
			continue
		}
		tag.Content.SetReferences(next)
		tag.Content.SetUpdateTime(now)
		if !keep && len(previousUUIDs) == 0 && len(next) == 0 && (legacyTitle || migrationTitle) {
			tag.SetDeleted(true)
		}
		tags[index] = tag
		changed[tag.UUID] = true
	}
	return nil
}

func detachManagedTagReferences(
	existing items.Tags,
	noteUUID string,
	previousTitles, previousUUIDs []string,
) (items.Tags, error) {
	working := append(items.Tags(nil), existing...)
	changed := map[string]bool{}
	if err := reconcileManagedTagReferences(
		working,
		changed,
		noteUUID,
		"",
		previousTitles,
		previousUUIDs,
	); err != nil {
		return nil, err
	}
	result := items.Tags{}
	for index := range working {
		if changed[working[index].UUID] {
			result = append(result, working[index])
		}
	}
	return result, nil
}

func tagHasReference(tag items.Tag, itemUUID string) bool {
	for _, ref := range tag.Content.References() {
		if ref.UUID == itemUUID {
			return true
		}
	}
	return false
}

func noteHasActiveTagReference(tags items.Tags, noteUUID string) bool {
	for _, tag := range tags {
		if !tag.IsDeleted() && tagHasReference(tag, noteUUID) {
			return true
		}
	}
	return false
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
