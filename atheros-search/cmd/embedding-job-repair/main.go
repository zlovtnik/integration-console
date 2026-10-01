package main

import (
	"log"
	"os"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/app/repair"
)

func main() {
	if err := repair.Run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
