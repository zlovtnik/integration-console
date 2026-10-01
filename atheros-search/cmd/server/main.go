package main

import (
	"os"

	"github.com/rs/zerolog/log"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/app"
)

func main() {
	if err := app.Run(); err != nil {
		log.Error().Err(err).Msg("atheros-search stopped")
		os.Exit(1)
	}
}
