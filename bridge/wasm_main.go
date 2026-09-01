//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
)

func main() {
	bridge := js.FuncOf(func(_ js.Value, args []js.Value) any {
		promise := js.Global().Get("Promise")
		executor := js.FuncOf(func(_ js.Value, callbacks []js.Value) any {
			resolve := callbacks[0]
			go func() {
				output := response{OK: false, Code: "sn_bridge_protocol", Message: "request is missing"}
				if len(args) > 0 {
					func() {
						defer func() {
							if recover() != nil {
								output = response{OK: false, Code: "sn_bridge_panic", Message: "the Standard Notes bridge stopped safely"}
							}
						}()
						output = handle([]byte(args[0].String()))
					}()
				}
				encoded, _ := json.Marshal(output)
				resolve.Invoke(string(encoded))
			}()
			return nil
		})
		result := promise.New(executor)
		executor.Release()
		return result
	})
	js.Global().Set("__aicNotesStandardNotesBridge", bridge)
	select {}
}
