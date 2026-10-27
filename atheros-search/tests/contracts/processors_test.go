//go:build stackcontract

package contracts

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/operations"
)

type processorManifest struct {
	Processors []struct {
		ID             string `json:"id"`
		Owner          string `json:"owner"`
		DefaultEnabled bool   `json:"default_enabled"`
	} `json:"processors"`
}

func TestOperationsStagesUseCanonicalProcessorOwners(t *testing.T) {
	// #nosec G304 -- Test-only canonical path resolved under ATHSEARCH_STACK_ROOT.
	data, err := os.ReadFile(filepath.Join(stackRoot(t), "sql", "postgres", "contracts", "processors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest processorManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	owners := make(map[string]string)
	for _, processor := range manifest.Processors {
		owners[processor.ID] = processor.Owner
	}
	for _, stage := range operations.New(nil, "", "").Pipeline(context.Background()).Stages {
		if owner, exists := owners[stage.ID]; !exists || owner != stage.Owner {
			t.Errorf("operation stage %q owner %q disagrees with canonical catalog %q", stage.ID, stage.Owner, owner)
		}
	}
}

func TestSharedManifestAssignsAtherosSearchProcessorsExactlyOnce(t *testing.T) {
	manifestPath := filepath.Join(stackRoot(t), "sql", "postgres", "contracts", "processors.json")
	// #nosec G304 -- Test-only canonical paths resolved under ATHSEARCH_STACK_ROOT.
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read processor manifest: %v", err)
	}
	var manifest processorManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("decode processor manifest: %v", err)
	}

	owned := make(map[string]int)
	all := make(map[string]int)
	for _, processor := range manifest.Processors {
		all[processor.ID]++
		if processor.DefaultEnabled {
			t.Errorf("processor %q must be disabled by default", processor.ID)
		}
		if processor.Owner == "atheros-search" {
			owned[processor.ID]++
		}
	}
	for id, count := range all {
		if count != 1 {
			t.Errorf("processor %q has %d manifest owners", id, count)
		}
	}
	expected := map[string]int{"embedding-completer": 1, "embedding-lease-recovery": 1}
	if len(owned) != len(expected) {
		t.Fatalf("unexpected Atheros Search ownership: %#v", owned)
	}
	for id, count := range expected {
		if owned[id] != count {
			t.Errorf("processor %q ownership = %d, want %d", id, owned[id], count)
		}
	}
}
