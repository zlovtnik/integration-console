// Package testdb opens only the isolated databases supplied by the contract runner.
package testdb

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func Provision(t *testing.T) *sql.DB { t.Helper(); return open(t, "ATHSEARCH_PROVISION_TEST_DSN") }
func Runtime(t *testing.T) *sql.DB   { t.Helper(); return open(t, "ATHSEARCH_REPORT_TEST_DSN") }
func open(t *testing.T, key string) *sql.DB {
	t.Helper()
	dsn := os.Getenv(key)
	if dsn == "" {
		t.Fatalf("%s is required; run make db-contract", key)
	}
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := database.PingContext(t.Context()); err != nil {
		t.Fatal(err)
	}
	return database
}
