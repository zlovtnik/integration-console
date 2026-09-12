package health

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/db"
)

type countingDatabase struct {
	countCalls int
}

func (d *countingDatabase) Health(context.Context) error { return nil }

func (d *countingDatabase) SchemaReady(context.Context) (db.SchemaReadyStatus, error) {
	return db.SchemaReadyStatus{Ready: true}, nil
}

func (d *countingDatabase) CountEmbeddings(context.Context) (db.EmbeddingCounts, error) {
	d.countCalls++
	return db.EmbeddingCounts{Event: 1, Device: 1}, nil
}

func TestCheckCachesEmbeddingCounts(t *testing.T) {
	database := &countingDatabase{}
	readiness := &Readiness{DB: database}
	require.NoError(t, readiness.Check(context.Background()))
	require.NoError(t, readiness.Check(context.Background()))
	require.Equal(t, 1, database.countCalls)
}

type schemaDatabase struct {
	countingDatabase
	check func(context.Context) (db.SchemaReadyStatus, error)
}

func (d *schemaDatabase) SchemaReady(ctx context.Context) (db.SchemaReadyStatus, error) {
	return d.check(ctx)
}

func TestSchemaWaitPreservesDatabaseErrorAfterDeadline(t *testing.T) {
	missingTable := errors.New(`relation "atheros_search.schema_readiness" does not exist (SQLSTATE 42P01)`)
	calls := 0
	database := &schemaDatabase{check: func(ctx context.Context) (db.SchemaReadyStatus, error) {
		calls++
		if calls == 1 {
			return db.SchemaReadyStatus{}, missingTable
		}
		<-ctx.Done()
		return db.SchemaReadyStatus{}, fmt.Errorf("statement cleanup: %w", ctx.Err())
	}}
	err := WaitForSchemaReady(context.Background(), database, 50*time.Millisecond, time.Millisecond, zerolog.Nop())
	require.ErrorIs(t, err, missingTable)
	require.Contains(t, err.Error(), "schema readiness timeout")
}

func TestSchemaWaitRecoversAfterProvisioning(t *testing.T) {
	calls := 0
	database := &schemaDatabase{check: func(ctx context.Context) (db.SchemaReadyStatus, error) {
		deadline, ok := ctx.Deadline()
		require.True(t, ok)
		require.LessOrEqual(t, time.Until(deadline), 5*time.Second)
		calls++
		if calls == 1 {
			return db.SchemaReadyStatus{}, errors.New("relation does not exist")
		}
		return db.SchemaReadyStatus{Ready: true}, nil
	}}
	require.NoError(t, WaitForSchemaReady(context.Background(), database, time.Minute, time.Millisecond, zerolog.Nop()))
	require.Equal(t, 2, calls)
}

func TestSchemaWaitFailsClosedOnManifestMismatch(t *testing.T) {
	database := &schemaDatabase{check: func(context.Context) (db.SchemaReadyStatus, error) {
		return db.SchemaReadyStatus{VectorReady: true, ManifestSHA256: "old", ExpectedSHA256: "new"}, nil
	}}
	err := WaitForSchemaReady(context.Background(), database, 10*time.Millisecond, time.Millisecond, zerolog.Nop())
	require.ErrorContains(t, err, "manifest_sha256=old expected_sha256=new")
}
