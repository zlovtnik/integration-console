package config

import (
	"errors"
	"net/url"
	"strings"
	"time"
)

func validateDQ(cfg Config) error {
	if !cfg.DQEnabled {
		return nil
	}
	if cfg.DQRemoteOrigin != "" {
		u, err := url.Parse(cfg.DQRemoteOrigin)
		if err != nil || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery || strings.ContainsAny(cfg.DQRemoteOrigin, " \t\r\n;#") || u.Scheme != "https" && (u.Scheme != "http" || u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
			return errors.New("ATHSEARCH_DQ_REMOTE_ORIGIN must be an HTTPS origin (loopback HTTP allowed)")
		}
	}
	parsed, err := url.Parse(cfg.DQManagerURL)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.ForceQuery || parsed.RawQuery != "" || parsed.Fragment != "" || strings.HasSuffix(cfg.DQManagerURL, "#") || parsed.Path != "" && parsed.Path != "/" || parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("ATHSEARCH_DQ_MANAGER_URL must be an absolute HTTP(S) origin without credentials")
	}
	if cfg.DQServiceToken == "" || strings.ContainsAny(cfg.DQServiceToken, "\r\n\x00") || cfg.DQInstallationID == "" || cfg.DQNamespace == "" {
		return errors.New("enabled DQ requires ATHSEARCH_DQ_SERVICE_TOKEN, ATHSEARCH_DQ_INSTALLATION_ID and ATHSEARCH_DQ_NAMESPACE")
	}
	if cfg.DQTimeout < time.Second || cfg.DQTimeout > 30*time.Second {
		return errors.New("ATHSEARCH_DQ_TIMEOUT_SECONDS must be between 1 and 30")
	}
	if cfg.APIKeySHA256 == "" && cfg.JWTIssuer == "" {
		return errors.New("enabled DQ requires authenticated Atheros API access")
	}
	return nil
}
