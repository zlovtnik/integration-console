//go:build stackcontract

package contracts

import (
	"os"
	"path/filepath"
	"testing"
)

func stackRoot(t *testing.T) string {
	t.Helper()
	root := os.Getenv("ATHSEARCH_STACK_ROOT")
	if root == "" {
		t.Fatal("ATHSEARCH_STACK_ROOT must name the canonical ssl-proxy checkout")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, contract := range []string{"sql/postgres/atheros_search/manifest.yaml", "sql/postgres/atheros_search/grants/least_privilege.sql.tmpl", "sql/postgres/contracts/processors.json"} {
		if _, err := os.Stat(filepath.Join(root, contract)); err != nil {
			t.Fatalf("required stack contract %s: %v", contract, err)
		}
	}
	return root
}
