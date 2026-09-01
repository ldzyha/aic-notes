package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/items"
	"github.com/jonhadfield/gosn-v2/session"
)

const maxProjectImportResponseBytes = 3 * 1024 * 1024

type remoteProjectNote struct {
	RemoteUUID      string   `json:"remoteUuid"`
	Title           string   `json:"title"`
	LocalContent    string   `json:"localContent"`
	BaseHash        string   `json:"baseHash"`
	TagPath         []string `json:"tagPath"`
	ManagedTags     []string `json:"managedTags"`
	ManagedTagUUIDs []string `json:"managedTagUuids"`
	ReadOnly        bool     `json:"readOnly,omitempty"`
}

type projectTagAssignment struct {
	Path          []string
	ManagedTitles []string
	ManagedUUIDs  []string
}

func pullProject(input request) response {
	project := strings.TrimSpace(input.Project)
	if project == "" {
		return response{OK: false, Code: "sn_project_required", Message: "the workspace project name is empty"}
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
	notes, err := collectProjectNotes(decrypted.Notes(), decrypted.Tags(), project, lockedNotes, s.ReadOnlyAccess)
	if err != nil {
		return failure("sn_project_import_ambiguous", err, "Resolve duplicate or malformed AIC project tags in Standard Notes")
	}
	result := response{OK: true, Connected: true, Action: "pull-project", Notes: notes, SyncedAt: time.Now().UTC().Format(time.RFC3339)}
	encoded, err := json.Marshal(result)
	if err != nil || len(encoded) > maxProjectImportResponseBytes {
		return response{OK: false, Code: "sn_project_import_too_large", Message: "the project notes exceed the safe import response limit", Fixes: []string{"Import fewer project notes at a time or reduce unusually large note bodies"}}
	}
	return result
}

func collectProjectNotes(notes items.Notes, tags items.Tags, project string, locked map[string]bool, sessionReadOnly bool) ([]remoteProjectNote, error) {
	assignments, err := projectTagAssignments(tags, project)
	if err != nil {
		return nil, err
	}
	byUUID := make(map[string]items.Note, len(notes))
	for _, note := range notes {
		if note.IsDeleted() || (note.Content.Trashed != nil && *note.Content.Trashed) {
			continue
		}
		byUUID[note.UUID] = note
	}
	result := make([]remoteProjectNote, 0, len(assignments))
	for uuid, assignment := range assignments {
		note, ok := byUUID[uuid]
		if !ok {
			continue
		}
		result = append(result, remoteProjectNote{
			RemoteUUID:      uuid,
			Title:           note.Content.Title,
			LocalContent:    note.Content.Text,
			BaseHash:        contentHash(note.Content.Text),
			TagPath:         assignment.Path,
			ManagedTags:     assignment.ManagedTitles,
			ManagedTagUUIDs: assignment.ManagedUUIDs,
			ReadOnly:        sessionReadOnly || locked[uuid],
		})
	}
	// Migrate the historical root-note bug: older releases could create the
	// canonical project sidecar before attaching any project tag. Surface only
	// an exact project-note identity as a synthetic root-path candidate. The
	// host binds it first; the following normal sync adds the managed tag.
	var rootCandidate *remoteProjectNote
	for uuid, note := range byUUID {
		if _, tagged := assignments[uuid]; tagged ||
			noteHasActiveTagReference(tags, uuid) ||
			note.Content.Title != project ||
			markdownFrontmatterValue(note.Content.Text, "level") != "project-note" ||
			markdownFrontmatterValue(note.Content.Text, "title") != project {
			continue
		}
		candidate := remoteProjectNote{
			RemoteUUID:      uuid,
			Title:           note.Content.Title,
			LocalContent:    note.Content.Text,
			BaseHash:        contentHash(note.Content.Text),
			TagPath:         []string{project},
			ManagedTags:     []string{},
			ManagedTagUUIDs: []string{},
			ReadOnly:        sessionReadOnly || locked[uuid],
		}
		if rootCandidate != nil {
			return nil, fmt.Errorf("canonical untagged project note %q is duplicated", project)
		}
		rootCandidate = &candidate
	}
	if rootCandidate != nil {
		result = append(result, *rootCandidate)
	}
	return result, nil
}

func projectTagAssignments(tags items.Tags, project string) (map[string]projectTagAssignment, error) {
	active := make(items.Tags, 0, len(tags))
	for _, tag := range tags {
		if !tag.IsDeleted() {
			active = append(active, tag)
		}
	}
	assignments := map[string]projectTagAssignment{}

	rootIndex, err := selectProjectImportRoot(active, project)
	if err != nil {
		return nil, err
	}
	if rootIndex >= 0 {
		paths := map[string][]string{active[rootIndex].UUID: {project}}
		uuids := map[string][]string{active[rootIndex].UUID: {active[rootIndex].UUID}}
		seenPaths := map[string]string{project: active[rootIndex].UUID}
		for changed := true; changed; {
			changed = false
			for _, tag := range active {
				if _, known := paths[tag.UUID]; known {
					continue
				}
				parent, parentErr := tagParentUUID(tag)
				if parentErr != nil {
					if tagTouchesKnownParent(tag, paths) {
						return nil, parentErr
					}
					continue
				}
				parentPath, known := paths[parent]
				if !known {
					continue
				}
				path := append(append([]string{}, parentPath...), tag.Content.Title)
				key := strings.Join(path, "\x00")
				if other, exists := seenPaths[key]; exists && other != tag.UUID {
					return nil, fmt.Errorf("managed tag path %q is duplicated", strings.Join(path, "/"))
				}
				seenPaths[key] = tag.UUID
				paths[tag.UUID] = path
				uuids[tag.UUID] = append(append([]string{}, uuids[parent]...), tag.UUID)
				changed = true
			}
		}
		for _, tag := range active {
			path, inside := paths[tag.UUID]
			if !inside {
				continue
			}
			for _, ref := range tag.Content.References() {
				if ref.ContentType != common.SNItemTypeNote || strings.TrimSpace(ref.UUID) == "" {
					continue
				}
				if _, duplicate := assignments[ref.UUID]; duplicate {
					return nil, fmt.Errorf("note %q is attached to multiple project tag paths", ref.UUID)
				}
				assignments[ref.UUID] = projectTagAssignment{
					Path:          append([]string{}, path...),
					ManagedTitles: tagTitlesForUUIDs(active, uuids[tag.UUID]),
					ManagedUUIDs:  append([]string{}, uuids[tag.UUID]...),
				}
			}
		}
	}

	if err := addLegacyProjectAssignments(assignments, active, project); err != nil {
		return nil, err
	}
	return assignments, nil
}

// selectProjectImportRoot is deliberately more tolerant than the write path.
// Standard Notes can retain an empty duplicate tag after an interrupted or
// older AIC migration. Import may safely ignore such a shell, but it must still
// fail closed when two duplicate project trees both contain notes.
func selectProjectImportRoot(tags items.Tags, project string) (int, error) {
	candidates := []int{}
	for index, tag := range tags {
		if tag.Content.Title != project {
			continue
		}
		parent, err := tagParentUUID(tag)
		if err != nil || parent != "" {
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
	for _, index := range candidates {
		if projectSubtreeNoteCount(tags, tags[index].UUID) > 0 {
			active = append(active, index)
		}
	}
	switch len(active) {
	case 0:
		return -1, nil
	case 1:
		return active[0], nil
	default:
		return -1, fmt.Errorf("managed project tag %q has multiple active roots", project)
	}
}

func projectSubtreeNoteCount(tags items.Tags, rootUUID string) int {
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
	notes := map[string]bool{}
	for _, tag := range tags {
		if !inside[tag.UUID] {
			continue
		}
		for _, ref := range tag.Content.References() {
			if ref.ContentType == common.SNItemTypeNote && strings.TrimSpace(ref.UUID) != "" {
				notes[ref.UUID] = true
			}
		}
	}
	return len(notes)
}

func tagTouchesKnownParent(tag items.Tag, known map[string][]string) bool {
	if _, ok := known[tag.Content.ParentId]; ok && tag.Content.ParentId != "" {
		return true
	}
	for _, ref := range tag.Content.References() {
		if ref.ReferenceType == tagToParentReferenceType {
			if _, ok := known[ref.UUID]; ok {
				return true
			}
		}
	}
	return false
}

func tagTitlesForUUIDs(tags items.Tags, uuids []string) []string {
	result := make([]string, 0, len(uuids))
	for _, uuid := range uuids {
		for _, tag := range tags {
			if tag.UUID == uuid {
				result = append(result, tag.Content.Title)
				break
			}
		}
	}
	return result
}

func addLegacyProjectAssignments(assignments map[string]projectTagAssignment, tags items.Tags, project string) error {
	legacyProjectTitle := "project:" + project
	projectTags := []items.Tag{}
	pathTags := []items.Tag{}
	for _, tag := range tags {
		switch {
		case tag.Content.Title == legacyProjectTitle:
			projectTags = append(projectTags, tag)
		case strings.HasPrefix(tag.Content.Title, "path:"):
			pathTags = append(pathTags, tag)
		case strings.HasPrefix(tag.Content.Title, project+"."):
			path := []string{project}
			if suffix := strings.TrimPrefix(tag.Content.Title, project); suffix != "" {
				path = append(path, strings.Split(strings.TrimPrefix(suffix, "."), ".")...)
			}
			for _, ref := range tag.Content.References() {
				if ref.ContentType != common.SNItemTypeNote {
					continue
				}
				if _, native := assignments[ref.UUID]; native {
					continue
				}
				if _, duplicate := assignments[ref.UUID]; duplicate {
					return fmt.Errorf("legacy note %q has multiple project paths", ref.UUID)
				}
				assignments[ref.UUID] = projectTagAssignment{Path: path, ManagedTitles: []string{tag.Content.Title}, ManagedUUIDs: []string{tag.UUID}}
			}
		}
	}
	if len(projectTags) > 1 {
		return fmt.Errorf("legacy project tag %q is duplicated", legacyProjectTitle)
	}
	if len(projectTags) == 0 {
		return nil
	}
	projectTag := projectTags[0]
	for _, ref := range projectTag.Content.References() {
		if ref.ContentType != common.SNItemTypeNote {
			continue
		}
		if _, native := assignments[ref.UUID]; native {
			continue
		}
		matchingPaths := []items.Tag{}
		for _, candidate := range pathTags {
			if tagHasReference(candidate, ref.UUID) {
				matchingPaths = append(matchingPaths, candidate)
			}
		}
		if len(matchingPaths) != 1 {
			return fmt.Errorf("legacy note %q requires exactly one path tag", ref.UUID)
		}
		value := strings.TrimPrefix(matchingPaths[0].Content.Title, "path:")
		path := []string{project}
		if value != "" && value != "." {
			path = append(path, strings.Split(strings.ReplaceAll(value, "\\", "/"), "/")...)
		}
		assignments[ref.UUID] = projectTagAssignment{
			Path:          path,
			ManagedTitles: []string{projectTag.Content.Title, matchingPaths[0].Content.Title},
			ManagedUUIDs:  []string{projectTag.UUID, matchingPaths[0].UUID},
		}
	}
	return nil
}
