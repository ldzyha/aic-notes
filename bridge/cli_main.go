//go:build !js || !wasm

package main

import (
	"encoding/json"
	"io"
	"os"
)

func main() {
	defer func() {
		if recovered := recover(); recovered != nil {
			write(response{OK: false, Code: "sn_bridge_panic", Message: "the Standard Notes bridge stopped safely", Fixes: []string{"Retry, then reinstall the matching AIC Notes package if the problem persists"}})
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

func write(output response) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(true)
	_ = encoder.Encode(output)
}
