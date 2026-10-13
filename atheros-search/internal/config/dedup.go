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
	parsed, err := url.Parse(cfg.DQManagerURL)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" && parsed.Path != "/" || parsed.Scheme != "http" && parsed.Scheme != "https" {
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
