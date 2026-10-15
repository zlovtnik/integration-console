package dedup

import (
	"io"
	"net/http"
	"regexp"
	"strings"
)

var shellAsset = regexp.MustCompile(`^/dq-ui/assets/[a-zA-Z0-9_-]+\.(js|css|woff2|svg|png)$`)

// ServeAssets exposes only public shell files. Each request resolves the manager;
// neither browser credentials nor the delegated service identity are forwarded.
func (s *Service) ServeAssets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !s.options.Enabled {
		http.Error(w, "DQ is disabled", http.StatusNotFound)
		return
	}
	if r.URL.RawQuery != "" || r.URL.RawPath != "" || (r.URL.Path != "/dq-ui/embedded.html" && !shellAsset.MatchString(r.URL.Path)) {
		http.NotFound(w, r)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, strings.TrimRight(s.options.ManagerURL, "/")+r.URL.Path, nil) // #nosec G704 -- configured origin plus allowlisted shell path; no browser-controlled host.
	if err != nil {
		http.Error(w, "DQ is unavailable", http.StatusServiceUnavailable)
		return
	}
	response, err := s.client.Do(req) // #nosec G704 -- fixed configured origin, path allowlist above, redirects refused by the shared client.
	if err != nil {
		http.Error(w, "DQ is unavailable", http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = response.Body.Close() }() // Response metadata is bounded; close is best effort.
	if response.StatusCode != http.StatusOK {
		http.Error(w, "DQ is unavailable", http.StatusServiceUnavailable)
		return
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if err != nil || len(data) > 8<<20 {
		http.Error(w, "DQ is unavailable", http.StatusServiceUnavailable)
		return
	}
	remote := "'none'"
	if s.options.RemoteOrigin != "" {
		remote = s.options.RemoteOrigin
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src "+remote+"; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	} // A disconnected asset client cannot change the response.
}
