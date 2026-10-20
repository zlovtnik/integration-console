package queryscope

import (
	_ "embed"
	"net/netip"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"
)

const AuthorityNormalizationVersion = "proxy-authority-v1"

// PSL includes ICANN and PRIVATE rules from the same pinned bytes as Octopus.
//
//go:embed public_suffix_list.dat
var authorityPSL string

var authorityIDNA = idna.New(idna.MapForLookup(), idna.Transitional(false),
	idna.StrictDomainName(true), idna.ValidateLabels(true), idna.BidiRule(), idna.VerifyDNSLength(true))

var authorityRules = loadAuthorityRules()

type Authority struct {
	AuthorityRaw         *string `json:"authority_raw"`
	HostRaw              *string `json:"host_raw"`
	HostNormalized       *string `json:"host_normalized"`
	Port                 *int    `json:"port"`
	AuthorityNormalized  *string `json:"authority_normalized"`
	RegistrableDomain    *string `json:"registrable_domain"`
	NormalizationVersion string  `json:"normalization_version"`
	ParseStatus          string  `json:"parse_status"`
	AuthoritySource      string  `json:"authority_source"`
	SanitizationStatus   string  `json:"sanitization_status"`
}

// NormalizeAuthority is the pure exact-filter contract. Legacy substring Host
// filtering intentionally does not call this function. No routing port is inferred.
func NormalizeAuthority(raw *string, source string, sanitized bool) Authority {
	a := Authority{NormalizationVersion: AuthorityNormalizationVersion, ParseStatus: "invalid",
		AuthoritySource: source, SanitizationStatus: "not_sanitized"}
	if idna.UnicodeVersion != "15.0.0" {
		a.ParseStatus = "unsupported_idna_version"
		return a
	}
	if sanitized {
		a.SanitizationStatus = "sanitized"
	}
	if raw == nil || *raw == "" {
		a.AuthorityRaw = raw
		a.ParseStatus = "missing"
		return a
	}
	// Oversized or control-bearing evidence must not be echoed into structured diagnostics.
	if !utf8.ValidString(*raw) || len(*raw) > 1024 || strings.IndexFunc(*raw, unicode.IsControl) >= 0 {
		return a
	}
	v := *raw
	a.AuthorityRaw = &v
	if sanitized || strings.HasPrefix(strings.ToLower(v), "hmac:") {
		a.ParseStatus, a.SanitizationStatus = "sanitized", "sanitized"
		return a
	}
	switch source {
	case "http_authority", "connect_authority", "quic_authority", "sni", "original_destination", "legacy_host", "query":
	default:
		return a
	}
	if strings.ContainsAny(v, "@/\\?#%") || strings.IndexFunc(v, unicode.IsSpace) >= 0 {
		return a
	}
	host, portText, explicit := v, "", false
	bracketed := strings.HasPrefix(v, "[")
	if bracketed {
		end := strings.IndexByte(v, ']')
		if end < 0 {
			return a
		}
		host = v[1:end]
		tail := v[end+1:]
		if tail != "" {
			if !strings.HasPrefix(tail, ":") {
				return a
			}
			portText, explicit = tail[1:], true
		}
	} else if strings.Count(v, ":") == 1 {
		host, portText, _ = strings.Cut(v, ":")
		explicit = true
	}
	if explicit {
		if len(portText) == 0 || len(portText) > 5 || strings.Trim(portText, "0123456789") != "" {
			return a
		}
		port, err := strconv.Atoi(portText)
		if err != nil || port < 1 || port > 65535 {
			return a
		}
		a.Port = &port
	}
	a.HostRaw = &host
	var normalized, status string
	if ip, err := netip.ParseAddr(host); err == nil && ip.Zone() == "" {
		if ip.Is4() {
			if bracketed {
				return invalidAuthority(a)
			}
			normalized, status = ip.String(), "valid_ipv4"
		} else {
			normalized, status = canonicalIPv6(ip.As16()), "valid_ipv6"
		}
	} else {
		if bracketed || strings.ContainsAny(host, ":[]") {
			return invalidAuthority(a)
		}
		ascii, err := authorityIDNA.ToASCII(host)
		if err != nil {
			return invalidAuthority(a)
		}
		normalized = strings.TrimSuffix(strings.ToLower(ascii), ".")
		if normalized == "" || len(normalized) > 253 || strings.HasSuffix(normalized, ".") || strings.Contains(normalized, "..") || strings.Trim(normalized, "0123456789.") == "" {
			return invalidAuthority(a)
		}
		status = "valid_dns"
		a.RegistrableDomain = authorityDomain(normalized)
	}
	a.HostNormalized, a.ParseStatus = &normalized, status
	endpoint := normalized
	if status == "valid_ipv6" {
		endpoint = "[" + normalized + "]"
	}
	if a.Port != nil {
		endpoint += ":" + strconv.Itoa(*a.Port)
	}
	a.AuthorityNormalized = &endpoint
	return a
}

func invalidAuthority(a Authority) Authority {
	a.Port = nil
	return a
}

func canonicalIPv6(b [16]byte) string {
	parts := make([]string, 8)
	bestStart, bestLen, start := -1, 1, -1
	for i := range parts {
		n := uint16(b[i*2])<<8 | uint16(b[i*2+1])
		parts[i] = strconv.FormatUint(uint64(n), 16)
		if n == 0 {
			if start < 0 {
				start = i
			}
			if i-start+1 > bestLen {
				bestStart, bestLen = start, i-start+1
			}
		} else {
			start = -1
		}
	}
	if bestStart < 0 {
		return strings.Join(parts, ":")
	}
	return strings.Join(parts[:bestStart], ":") + "::" + strings.Join(parts[bestStart+bestLen:], ":")
}

func loadAuthorityRules() map[string]bool {
	rules := make(map[string]bool)
	for line := range strings.SplitSeq(authorityPSL, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		prefix := ""
		if strings.HasPrefix(line, "!") {
			prefix, line = "!", line[1:]
		}
		if strings.HasPrefix(line, "*.") {
			prefix, line = "*.", line[2:]
		}
		ascii, err := authorityIDNA.ToASCII(line)
		if err != nil {
			panic("invalid pinned authority PSL")
		}
		rules[prefix+ascii] = true
	}
	return rules
}

func authorityDomain(host string) *string {
	labels := strings.Split(host, ".")
	suffix := 1 // PSL's implicit * rule.
	for i := range labels {
		candidate := strings.Join(labels[i:], ".")
		if authorityRules["!"+candidate] {
			suffix = len(labels) - i - 1
			break
		}
		if authorityRules[candidate] && len(labels)-i > suffix {
			suffix = len(labels) - i
		}
		if i > 0 && authorityRules["*."+candidate] && len(labels)-i+1 > suffix {
			suffix = len(labels) - i + 1
		}
	}
	if len(labels) <= suffix {
		return nil
	}
	domain := strings.Join(labels[len(labels)-suffix-1:], ".")
	return &domain
}
