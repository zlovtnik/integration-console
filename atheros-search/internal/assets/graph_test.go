package assets

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeMergeDecisionAcceptsContractValues(t *testing.T) {
	for _, value := range []string{"merge", "not_match", "needs_more_data"} {
		got, err := normalizeMergeDecision(value)
		require.NoError(t, err)
		require.Equal(t, MergeDecision(value), got)
	}
	_, err := normalizeMergeDecision("undo_merge")
	require.ErrorContains(t, err, "unsupported merge decision")
}
