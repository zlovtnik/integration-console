//go:build stackcontract

package contracts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDeploymentConsumesSearchPortsHealthAndCanonicalChecksum(t *testing.T) {
	root := stackRoot(t)
	// #nosec G304 -- Test-only canonical file resolved under ATHSEARCH_STACK_ROOT.
	manifest, err := os.ReadFile(filepath.Join(root, "sql/postgres/atheros_search/manifest.yaml"))
	require.NoError(t, err)
	var checksum string
	for _, line := range strings.Split(string(manifest), "\n") {
		if value, ok := strings.CutPrefix(line, "manifest_sha256:"); ok {
			checksum = strings.TrimSpace(value)
		}
	}
	require.Len(t, checksum, 64)
	// #nosec G304 -- Test-only canonical file resolved under ATHSEARCH_STACK_ROOT.
	deployment, err := os.ReadFile(filepath.Join(root, "cyber-stack/base/atheros-search/deployment.yaml"))
	require.NoError(t, err)
	for _, fragment := range []string{
		"name: ATHSEARCH_SCHEMA_MANIFEST_SHA256\n              value: \"" + checksum + "\"",
		"name: ATHSEARCH_HTTP_PORT\n              value: \"8080\"",
		"name: ATHSEARCH_GRPC_PORT\n              value: \"50051\"",
		"name: ATHSEARCH_METRICS_PORT\n              value: \"9090\"",
		"name: ATHSEARCH_SCHEMA_READY_REQUIRED\n              value: \"true\"",
		"path: /healthz", "path: /readyz", "containerPort: 8080", "containerPort: 50051", "containerPort: 9090",
	} {
		require.Contains(t, string(deployment), fragment)
	}
}
