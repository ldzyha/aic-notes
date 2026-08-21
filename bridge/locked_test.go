package main

import (
	"testing"

	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/items"
)

func TestLockedNoteUUIDsUsesOnlyStandardNotesLockedFlag(t *testing.T) {
	decrypted := items.DecryptedItems{
		{UUID: "locked", ContentType: common.SNItemTypeNote, Content: `{"appData":{"org.standardnotes.sn":{"locked":true}}}`},
		{UUID: "unlocked", ContentType: common.SNItemTypeNote, Content: `{"appData":{"org.standardnotes.sn":{"locked":false}}}`},
		{UUID: "protected", ContentType: common.SNItemTypeNote, Content: `{"appData":{"org.standardnotes.sn":{"protected":true}}}`},
		{UUID: "other", ContentType: common.SNItemTypeTag, Content: `{"appData":{"org.standardnotes.sn":{"locked":true}}}`},
		{UUID: "malformed", ContentType: common.SNItemTypeNote, Content: `{`},
	}
	got := lockedNoteUUIDs(decrypted)
	if len(got) != 1 || !got["locked"] {
		t.Fatalf("unexpected locked notes: %#v", got)
	}
}
