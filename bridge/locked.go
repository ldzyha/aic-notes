package main

import (
	"encoding/json"

	"github.com/jonhadfield/gosn-v2/common"
	"github.com/jonhadfield/gosn-v2/items"
)

type noteLockContent struct {
	AppData map[string]json.RawMessage `json:"appData"`
}

type standardNotesAppData struct {
	Locked bool `json:"locked"`
}

func lockedNoteUUIDs(decrypted items.DecryptedItems) map[string]bool {
	locked := make(map[string]bool)
	for _, item := range decrypted {
		if item.ContentType != common.SNItemTypeNote || item.UUID == "" {
			continue
		}
		var content noteLockContent
		if err := json.Unmarshal([]byte(item.Content), &content); err != nil {
			continue
		}
		var appData standardNotesAppData
		if err := json.Unmarshal(content.AppData["org.standardnotes.sn"], &appData); err == nil && appData.Locked {
			locked[item.UUID] = true
		}
	}
	return locked
}
