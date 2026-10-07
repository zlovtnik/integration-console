package reporting

import (
	"database/sql"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/metrics"
)

type Service struct {
	WirelessProjection bool
	Pool               *sql.DB
	Metrics            *metrics.Metrics
}
