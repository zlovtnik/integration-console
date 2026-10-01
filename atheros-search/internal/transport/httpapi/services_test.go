package httpapi

import (
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/assets"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reporting"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/savedviews"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/search"
)

func testServices(s *search.Service) Services {
	if s == nil {
		return Services{}
	}
	return Services{Search: s, Reporting: &reporting.Service{Pool: s.Pool}, Assets: &assets.Service{Pool: s.Pool}, SavedViews: &savedviews.Service{Pool: s.Pool}}
}
