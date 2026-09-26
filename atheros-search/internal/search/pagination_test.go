package search

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPageCursorRoundTripAndFilterBinding(t *testing.T) {
	fingerprint, err := pageFingerprint(struct{ Location string }{Location: "lab"})
	require.NoError(t, err)
	want := pageCursor{Version: 1, Resource: "graph", Fingerprint: fingerprint, NodeAfter: "node:2", EdgeAfter: "edge:4"}
	encoded, err := encodePageCursor(want)
	require.NoError(t, err)
	require.NotContains(t, encoded, "node:2")

	got, err := decodePageCursor(encoded, "graph", fingerprint)
	require.NoError(t, err)
	require.Equal(t, want, got)

	_, err = decodePageCursor(encoded, "inventory", fingerprint)
	require.EqualError(t, err, "invalid page_cursor")
	_, err = decodePageCursor(encoded, "graph", "different-filter")
	require.EqualError(t, err, "invalid page_cursor")
}

func TestPageCursorRejectsMalformedValues(t *testing.T) {
	for _, value := range []string{"%%%", "e30", "eyJ2IjoxLCJyIjoiZ3JhcGgiLCJmIjoieCIsIngiOnRydWV9"} {
		_, err := decodePageCursor(value, "graph", "x")
		require.EqualError(t, err, "invalid page_cursor")
	}
}
