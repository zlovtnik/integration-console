package queryscope

import (
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
		Cases []struct {
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
