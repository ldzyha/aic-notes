package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/items"
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

func TestReconcileTagHierarchyCreatesNativeLeafPath(t *testing.T) {
	result, err := reconcileTagHierarchy(
		nil,
		"note",
		[]string{"demo", "src", "lib"},
		nil,
		nil,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Changed) != 3 || len(result.Titles) != 3 || len(result.UUIDs) != 3 {
		t.Fatalf("unexpected hierarchy result: %#v", result)
	}
	if strings.Join(result.Titles, "/") != "demo/src/lib" {
		t.Fatalf("unexpected title path: %#v", result.Titles)
	}
	byUUID := map[string]items.Tag{}
	for _, tag := range result.Changed {
		byUUID[tag.UUID] = tag
	}
	root := byUUID[result.UUIDs[0]]
	src := byUUID[result.UUIDs[1]]
	leaf := byUUID[result.UUIDs[2]]
	if parent, parentErr := tagParentUUID(root); parentErr != nil || parent != "" {
		t.Fatalf("root parent = %q, err = %v", parent, parentErr)
	}
	if parent, parentErr := tagParentUUID(src); parentErr != nil || parent != root.UUID {
		t.Fatalf("src parent = %q, err = %v", parent, parentErr)
	}
	if parent, parentErr := tagParentUUID(leaf); parentErr != nil || parent != src.UUID {
		t.Fatalf("leaf parent = %q, err = %v", parent, parentErr)
	}
	if tagHasReference(root, "note") || tagHasReference(src, "note") || !tagHasReference(leaf, "note") {
		t.Fatal("the note must be referenced only by the leaf tag")
	}
	payload, err := json.Marshal(leaf.Content)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"reference_type":"TagToParentTag"`) ||
		!strings.Contains(string(payload), `"content_type":"Tag"`) {
		t.Fatalf("native parent reference is missing: %s", payload)
	}
}

func TestReconcileTagHierarchyFallsBackToProjectOnly(t *testing.T) {
	result, err := reconcileTagHierarchy(
		nil,
		"note",
		[]string{"demo", "src", "lib"},
		nil,
		nil,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Titles) != 1 || result.Titles[0] != "demo" || len(result.Changed) != 1 {
		t.Fatalf("fallback created more than the project tag: %#v", result)
	}
	if !tagHasReference(result.Changed[0], "note") {
		t.Fatal("project-only fallback did not attach the note")
	}
}

func TestReconcileTagHierarchyReusesSameTitleUnderExactParent(t *testing.T) {
	root, _ := items.NewTag("demo", nil)
	one, _ := items.NewTag("one", items.ItemReferences{parentTagReference(root.UUID)})
	two, _ := items.NewTag("two", items.ItemReferences{parentTagReference(root.UUID)})
	otherLeaf, _ := items.NewTag("shared", items.ItemReferences{
		parentTagReference(one.UUID),
		{UUID: "other", ContentType: common.SNItemTypeNote},
	})
	targetLeaf, _ := items.NewTag("shared", items.ItemReferences{parentTagReference(two.UUID)})
	result, err := reconcileTagHierarchy(
		items.Tags{root, one, two, otherLeaf, targetLeaf},
		"note",
		[]string{"demo", "two", "shared"},
		nil,
		nil,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.UUIDs[2] != targetLeaf.UUID || len(result.Changed) != 1 {
		t.Fatalf("wrong same-title child selected: %#v", result)
	}
	if !tagHasReference(result.Changed[0], "note") || tagHasReference(otherLeaf, "note") {
		t.Fatal("leaf attachment escaped its exact parent")
	}
}

func TestReconcileTagHierarchyRejectsDuplicateRoot(t *testing.T) {
	first, _ := items.NewTag("demo", nil)
	second, _ := items.NewTag("demo", nil)
	_, err := reconcileTagHierarchy(
		items.Tags{first, second},
		"note",
		[]string{"demo"},
		nil,
		nil,
		true,
	)
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate root did not fail closed: %v", err)
	}
}

func TestReconcileTagHierarchyRejectsMalformedParent(t *testing.T) {
	root, _ := items.NewTag("demo", nil)
	child, _ := items.NewTag("src", items.ItemReferences{
		parentTagReference(root.UUID),
		parentTagReference(root.UUID),
	})
	_, err := reconcileTagHierarchy(
		items.Tags{root, child},
		"note",
		[]string{"demo", "src"},
		nil,
		nil,
		true,
	)
	if err == nil || !strings.Contains(err.Error(), "multiple parent") {
		t.Fatalf("malformed parent did not fail closed: %v", err)
	}
}

func TestProjectTagAssignmentsReadsNativeHierarchy(t *testing.T) {
	root, _ := items.NewTag("demo", nil)
	src, _ := items.NewTag("src", items.ItemReferences{parentTagReference(root.UUID)})
	leaf, _ := items.NewTag("lib", items.ItemReferences{
		parentTagReference(src.UUID),
		{UUID: "note", ContentType: common.SNItemTypeNote},
	})
	assignments, err := projectTagAssignments(items.Tags{root, src, leaf}, "demo")
	if err != nil {
		t.Fatal(err)
	}
	assignment, ok := assignments["note"]
	if !ok || strings.Join(assignment.Path, "/") != "demo/src/lib" {
		t.Fatalf("native project note path was not recovered: %#v", assignments)
	}
	if len(assignment.ManagedUUIDs) != 3 || assignment.ManagedUUIDs[2] != leaf.UUID {
		t.Fatalf("native managed UUID path was not preserved: %#v", assignment)
	}
}

func TestProjectTagAssignmentsIgnoresEmptyDuplicateRoot(t *testing.T) {
	active, _ := items.NewTag("demo", items.ItemReferences{{UUID: "note", ContentType: common.SNItemTypeNote}})
	empty, _ := items.NewTag("demo", nil)
	assignments, err := projectTagAssignments(items.Tags{empty, active}, "demo")
	if err != nil {
		t.Fatal(err)
	}
	assignment, ok := assignments["note"]
	if !ok || strings.Join(assignment.Path, "/") != "demo" || assignment.ManagedUUIDs[0] != active.UUID {
		t.Fatalf("active project root was not selected: %#v", assignments)
	}
}

func TestProjectTagAssignmentsRejectsTwoActiveDuplicateRoots(t *testing.T) {
	first, _ := items.NewTag("demo", items.ItemReferences{{UUID: "first", ContentType: common.SNItemTypeNote}})
	second, _ := items.NewTag("demo", items.ItemReferences{{UUID: "second", ContentType: common.SNItemTypeNote}})
	_, err := projectTagAssignments(items.Tags{first, second}, "demo")
	if err == nil || !strings.Contains(err.Error(), "multiple active roots") {
		t.Fatalf("two active project roots did not fail closed: %v", err)
	}
}

func TestDiscoverRemoteNoteRecoversExactManagedIdentity(t *testing.T) {
	root, _ := items.NewTag("demo", nil)
	src, _ := items.NewTag("src", items.ItemReferences{
		parentTagReference(root.UUID),
		{UUID: "wanted", ContentType: common.SNItemTypeNote},
		{UUID: "other", ContentType: common.SNItemTypeNote},
	})
	wanted, _ := items.NewNote("app.ts", "---\nlevel: file-note\n---\nremote", nil)
	wanted.UUID = "wanted"
	other, _ := items.NewNote("other.ts", "remote", nil)
	other.UUID = "other"
	got, err := discoverRemoteNote(items.Notes{wanted, other}, items.Tags{root, src}, "app.ts", []string{"demo", "src"}, "note")
	if err != nil || got == nil || got.UUID != wanted.UUID {
		t.Fatalf("exact remote identity was not recovered: got=%#v err=%v", got, err)
	}
}

func TestDiscoverRemoteNoteSeparatesDocumentFromSidecarWithSameTitle(t *testing.T) {
	root, _ := items.NewTag("demo", items.ItemReferences{
		{UUID: "sidecar", ContentType: common.SNItemTypeNote},
		{UUID: "document", ContentType: common.SNItemTypeNote},
	})
	sidecar, _ := items.NewNote("README.md", "---\nlevel: file-note\n---\nnotes", nil)
	sidecar.UUID = "sidecar"
	document, _ := items.NewNote("README.md", "# Read me", nil)
	document.UUID = "document"
	gotNote, noteErr := discoverRemoteNote(
		items.Notes{sidecar, document},
		items.Tags{root},
		"README.md",
		[]string{"demo"},
		"note",
	)
	gotDocument, documentErr := discoverRemoteNote(
		items.Notes{sidecar, document},
		items.Tags{root},
		"README.md",
		[]string{"demo"},
		"document",
	)
	if noteErr != nil || gotNote == nil || gotNote.UUID != sidecar.UUID {
		t.Fatalf("sidecar identity was not isolated: got=%#v err=%v", gotNote, noteErr)
	}
	if documentErr != nil || gotDocument == nil || gotDocument.UUID != document.UUID {
		t.Fatalf("document identity was not isolated: got=%#v err=%v", gotDocument, documentErr)
	}
}

func TestDiscoverRemoteNoteRejectsDuplicateManagedIdentity(t *testing.T) {
	root, _ := items.NewTag("demo", items.ItemReferences{
		{UUID: "first", ContentType: common.SNItemTypeNote},
		{UUID: "second", ContentType: common.SNItemTypeNote},
	})
	first, _ := items.NewNote("app.ts", "one", nil)
	first.UUID = "first"
	second, _ := items.NewNote("app.ts", "two", nil)
	second.UUID = "second"
	_, err := discoverRemoteNote(items.Notes{first, second}, items.Tags{root}, "app.ts", []string{"demo"}, "")
	if err == nil || !strings.Contains(err.Error(), "duplicated") {
		t.Fatalf("duplicate remote identity did not fail closed: %v", err)
	}
}

func TestProjectTagAssignmentsReadsLegacyProjectAndPath(t *testing.T) {
	project, _ := items.NewTag("project:demo", items.ItemReferences{{UUID: "note", ContentType: common.SNItemTypeNote}})
	path, _ := items.NewTag("path:src/lib", items.ItemReferences{{UUID: "note", ContentType: common.SNItemTypeNote}})
	assignments, err := projectTagAssignments(items.Tags{project, path}, "demo")
	if err != nil {
		t.Fatal(err)
	}
	assignment, ok := assignments["note"]
	if !ok || strings.Join(assignment.Path, "/") != "demo/src/lib" {
		t.Fatalf("legacy project note path was not recovered: %#v", assignments)
	}
	if len(assignment.ManagedUUIDs) != 2 {
		t.Fatalf("legacy managed UUIDs were not preserved: %#v", assignment)
	}
}

func TestCollectProjectNotesExcludesTrashedContent(t *testing.T) {
	note, _ := items.NewNote("app.ts", "body", nil)
	note.UUID = "note"
	note.Content.SetTrashed(true)
	root, _ := items.NewTag("demo", items.ItemReferences{{UUID: note.UUID, ContentType: common.SNItemTypeNote}})
	got, err := collectProjectNotes(items.Notes{note}, items.Tags{root}, "demo", map[string]bool{}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("trashed note was imported: %#v", got)
	}
}

func TestCollectProjectNotesRecoversOneCanonicalUntaggedRoot(t *testing.T) {
	note, _ := items.NewNote(
		"demo",
		"---\ntitle: demo\nlevel: project-note\n---\n\nroot body",
		nil,
	)
	note.UUID = "root-note"
	got, err := collectProjectNotes(
		items.Notes{note},
		items.Tags{},
		"demo",
		map[string]bool{},
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].RemoteUUID != note.UUID ||
		strings.Join(got[0].TagPath, "/") != "demo" || len(got[0].ManagedTagUUIDs) != 0 {
		t.Fatalf("canonical untagged root was not recovered: %#v", got)
	}
}

func TestCollectProjectNotesRejectsDuplicateCanonicalUntaggedRoots(t *testing.T) {
	first, _ := items.NewNote("demo", "---\ntitle: demo\nlevel: project-note\n---", nil)
	first.UUID = "first"
	second, _ := items.NewNote("demo", "---\ntitle: demo\nlevel: project-note\n---", nil)
	second.UUID = "second"
	_, err := collectProjectNotes(
		items.Notes{first, second},
		items.Tags{},
		"demo",
		map[string]bool{},
		false,
	)
	if err == nil || !strings.Contains(err.Error(), "duplicated") {
		t.Fatalf("duplicate canonical roots did not fail closed: %v", err)
	}
}

func TestCollectProjectNotesDoesNotStealCanonicalRootFromAnotherTag(t *testing.T) {
	note, _ := items.NewNote("demo", "---\ntitle: demo\nlevel: project-note\n---", nil)
	note.UUID = "root-note"
	personal, _ := items.NewTag("personal", items.ItemReferences{{UUID: note.UUID, ContentType: common.SNItemTypeNote}})
	got, err := collectProjectNotes(
		items.Notes{note},
		items.Tags{personal},
		"demo",
		map[string]bool{},
		false,
	)
	if err != nil || len(got) != 0 {
		t.Fatalf("another tag's note was recovered as an untagged root: got=%#v err=%v", got, err)
	}
}

func TestMarkdownFrontmatterValueReadsOnlyTopLevelProperties(t *testing.T) {
	markdown := "---\ndocument:\n  level: file-note\nlevel: document\n---\nBody"
	if got := markdownFrontmatterValue(markdown, "level"); got != "document" {
		t.Fatalf("nested property shadowed top-level level: %q", got)
	}
}

func TestReconcileTagHierarchyMigratesOnlyOwnedReferences(t *testing.T) {
	noteRef := items.ItemReference{UUID: "note", ContentType: common.SNItemTypeNote}
	otherRef := items.ItemReference{UUID: "other", ContentType: common.SNItemTypeNote}
	legacy, _ := items.NewTag("aic", items.ItemReferences{noteRef})
	sharedLegacy, _ := items.NewTag("path:docs", items.ItemReferences{noteRef, otherRef})
	previous, _ := items.NewTag("demo.old", items.ItemReferences{noteRef})
	root, _ := items.NewTag("demo", nil)
	required, _ := items.NewTag("docs", items.ItemReferences{parentTagReference(root.UUID), otherRef})
	personal, _ := items.NewTag("personal", items.ItemReferences{noteRef})

	result, err := reconcileTagHierarchy(
		items.Tags{legacy, sharedLegacy, previous, root, required, personal},
		"note",
		[]string{"demo", "docs"},
		[]string{"demo.old"},
		nil,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	byTitle := map[string]items.Tag{}
	for _, tag := range result.Changed {
		byTitle[tag.Content.Title] = tag
	}
	if !byTitle["aic"].IsDeleted() || !byTitle["demo.old"].IsDeleted() {
		t.Fatal("empty legacy and previously-owned tags must be retired")
	}
	if byTitle["path:docs"].IsDeleted() || tagReferences(items.Tags{byTitle["path:docs"]}, "path:docs", "note") {
		t.Fatal("shared legacy tag must keep other references and drop only this note")
	}
	if !tagHasReference(byTitle["docs"], "note") {
		t.Fatal("required native leaf must reference the synchronized note")
	}
	if parent, parentErr := tagParentUUID(byTitle["docs"]); parentErr != nil || parent != root.UUID {
		t.Fatalf("native leaf parent = %q, err = %v", parent, parentErr)
	}
	if _, touched := byTitle["personal"]; touched {
		t.Fatal("unrelated user tag must not be changed")
	}
}

func TestReconcileTagHierarchyUsesExactPreviousUUIDs(t *testing.T) {
	noteRef := items.ItemReference{UUID: "note", ContentType: common.SNItemTypeNote}
	root, _ := items.NewTag("demo", nil)
	oldLeaf, _ := items.NewTag("src", items.ItemReferences{parentTagReference(root.UUID), noteRef})
	newLeaf, _ := items.NewTag("docs", items.ItemReferences{parentTagReference(root.UUID)})
	otherRoot, _ := items.NewTag("other", nil)
	sameTitleUserTag, _ := items.NewTag("src", items.ItemReferences{
		parentTagReference(otherRoot.UUID),
		noteRef,
	})
	result, err := reconcileTagHierarchy(
		items.Tags{root, oldLeaf, newLeaf, otherRoot, sameTitleUserTag},
		"note",
		[]string{"demo", "docs"},
		[]string{"demo", "src"},
		[]string{root.UUID, oldLeaf.UUID},
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	changed := map[string]items.Tag{}
	for _, tag := range result.Changed {
		changed[tag.UUID] = tag
	}
	if tagHasReference(changed[oldLeaf.UUID], "note") || !tagHasReference(changed[newLeaf.UUID], "note") {
		t.Fatal("exact previous leaf was not replaced")
	}
	if _, touched := changed[sameTitleUserTag.UUID]; touched || !tagHasReference(sameTitleUserTag, "note") {
		t.Fatal("same-title user tag under another parent was changed")
	}
	if changed[oldLeaf.UUID].IsDeleted() {
		t.Fatal("native hierarchy tags are not deleted without ownership proof")
	}
}

func TestPrepareRemoteTrashIsRecoverableAndIdempotent(t *testing.T) {
	note, err := items.NewNote("Example", "body", items.ItemReferences{})
	if err != nil {
		t.Fatal(err)
	}
	note.UUID = "note"
	now := time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC)
	outgoing, action, err := prepareRemoteTrash(&note, nil, nil, nil, now)
	if err != nil {
		t.Fatal(err)
	}
	if action != "trashed" || len(outgoing) != 1 || note.Content.Trashed == nil || !*note.Content.Trashed {
		t.Fatalf("first Trash transition failed: action=%q outgoing=%d trashed=%v", action, len(outgoing), note.Content.Trashed)
	}
	outgoing, action, err = prepareRemoteTrash(&note, nil, nil, nil, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if action != "already-trashed" || len(outgoing) != 0 {
		t.Fatalf("idempotent retry changed the remote again: action=%q outgoing=%d", action, len(outgoing))
	}
}

func TestPrepareRemoteTrashRemovesOnlyManagedTagReferences(t *testing.T) {
	note, _ := items.NewNote("Example", "body", items.ItemReferences{})
	note.UUID = "note"
	noteRef := items.ItemReference{UUID: note.UUID, ContentType: common.SNItemTypeNote}
	managed, _ := items.NewTag("src", items.ItemReferences{noteRef})
	personal, _ := items.NewTag("personal", items.ItemReferences{noteRef})
	outgoing, _, err := prepareRemoteTrash(
		&note,
		items.Tags{managed, personal},
		[]string{"demo", "src"},
		[]string{"root-uuid", managed.UUID},
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(outgoing) != 2 {
		t.Fatalf("expected remote note plus one managed tag update, got %d items", len(outgoing))
	}
	tag, ok := outgoing[1].(*items.Tag)
	if !ok || tag.IsDeleted() || tagHasReference(*tag, "note") {
		t.Fatal("exact native leaf reference was not removed safely")
	}
	if tag.Content.Title == "personal" {
		t.Fatal("an unrelated user tag was changed")
	}
}

func parentTagReference(uuid string) items.ItemReference {
	return items.ItemReference{
		UUID:          uuid,
		ContentType:   common.SNItemTypeTag,
		ReferenceType: tagToParentReferenceType,
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
