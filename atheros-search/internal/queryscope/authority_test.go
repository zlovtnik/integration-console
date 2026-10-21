package queryscope

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"golang.org/x/net/idna"
)

func TestAuthoritySharedCorpus(t *testing.T) {
	if idna.UnicodeVersion != "15.0.0" {
		t.Fatal("proxy-authority-v1 requires Unicode 15.0 IDNA tables; run with the supported Go 1.26 toolchain")
	}
	data, err := os.ReadFile("testdata/proxy-authority-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Version            string `json:"version"`
		IDNAUnicodeVersion string `json:"idna_unicode_version"`
		PSLSHA256          string `json:"psl_sha256"`
		Cases              []struct {
			ID    string `json:"id"`
			Input struct {
				Authority *string `json:"authority"`
				Source    string  `json:"source"`
				Sanitized bool    `json:"sanitized"`
			} `json:"input"`
			Expected Authority `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if corpus.Version != AuthorityNormalizationVersion {
		t.Fatalf("corpus version = %q, expected %q", corpus.Version, AuthorityNormalizationVersion)
	}
	if corpus.IDNAUnicodeVersion != idna.UnicodeVersion {
		t.Fatalf("corpus IDNA Unicode version = %q, expected %q", corpus.IDNAUnicodeVersion, idna.UnicodeVersion)
	}
	pslDigest := sha256.Sum256([]byte(authorityPSL))
	if got := hex.EncodeToString(pslDigest[:]); got != corpus.PSLSHA256 {
		t.Fatalf("authority PSL SHA-256 = %q, expected corpus digest %q", got, corpus.PSLSHA256)
	}
	if len(corpus.Cases) < 60 {
		t.Fatal("incomplete shared corpus")
	}
	for _, c := range corpus.Cases {
		t.Run(c.ID, func(t *testing.T) {
			got := NormalizeAuthority(c.Input.Authority, c.Input.Source, c.Input.Sanitized)
			if !reflect.DeepEqual(got, c.Expected) {
				t.Errorf("got %+v, expected %+v", got, c.Expected)
			}
			if again := NormalizeAuthority(c.Input.Authority, c.Input.Source, c.Input.Sanitized); !reflect.DeepEqual(got, again) {
				t.Fatal("nondeterministic normalization")
			}
		})
	}
}

func TestAuthorityDiscardsUserinfoBeforeClassification(t *testing.T) {
	for _, raw := range []string{"user:secret@example.com:443", "hmac:user@example.com", "@example.com"} {
		for _, sanitized := range []bool{false, true} {
			for _, source := range []string{"query", "unknown"} {
				got := NormalizeAuthority(&raw, source, sanitized)
				if got.AuthorityRaw != nil || got.HostRaw != nil || got.ParseStatus != "invalid" {
					t.Fatalf("userinfo retained or misclassified for source=%s sanitized=%t", source, sanitized)
				}
			}
		}
	}
}
