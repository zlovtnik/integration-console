package health

import (
	"context"
	"testing"

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
